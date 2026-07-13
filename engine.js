/* Lorcana engine — log parser + seed data.
   Classic script. Defines globalThis.LORCANA and globalThis.LORCANA_SEED.
   Parser ported verbatim from the original dashboard, plus a deterministic
   rule-based "match coach" layer (parserVersion 2) that reads each deck's
   saved strategy text and turns a parsed game into win/loss reasoning,
   turning points, a plan-adherence score, and practical next-game advice.
   No external AI/API — everything here is plain JS pattern matching. */
(function (root) {
  const DECK = ["Dale - Ready for His Shot","Mulan - Elite Archer","Mulan - Injured Soldier",
  "This Growing Pressure","Ohana Means Family","Reuben - Sandwich Expert","Bambi - Ethereal Fawn",
  "Scrooge McDuck - Ghostly Ebenezer","Zeus - Defiant God","Gaston - Frightful Bully","Webby's Diary",
  "The Horseman Strikes!","Stitch - Carefree Snowboarder","Stitch - Carefree Surfer","Medallion Weights",
  "The Sword of Shan-Yu","Chip - Retrieval Expert"];

  const ARCHETYPES = ["Toys","Dwarves","Sapphire/Steel Control","Detective","Locations","Princesses","Amethyst/Sapphire Evasive","Amber/Emerald Aggro","Amber/Amethyst Evasive","Emerald/Sapphire Control","Amber/Ruby Toys",
    "Amber/Sapphire","Amber/Steel","Amethyst/Emerald","Amethyst/Ruby","Amethyst/Steel","Emerald/Ruby","Emerald/Steel","Ruby/Sapphire","Ruby/Steel",
    "Other / Unknown"];
  const WIN_CATS = ["Out-raced (go-wide tempo)","Dale + Mulan board clear","Ground them out (Ohana/Boost)","Removal denied their clock","Opponent conceded behind","Closed to 20 lore"];
  const LOSS_CATS = ["Couldn't stabilize vs aggro","Out-removed by control","Evasive out-raced me","Locations ticked me out","Dale answered / no combo online","Slow start / mulligan whiff","Never built a clock","Flooded / drew no threats"];

  const COMBO_DEFS = [
    {key:"dale",        label:"Dale resolved"},
    {key:"mulanElite",  label:"Mulan – Elite Archer"},
    {key:"tripleShot",  label:"Triple Shot fired"},
    {key:"sword",       label:"Sword double-swing"},
    {key:"ohana",       label:"Ohana / Stitch heal-draw"},
    {key:"reuben",      label:"Reuben Lunch Special"},
    {key:"snowboarder", label:"Stitch draw engine"},
    {key:"gastonLock",  label:"Gaston lock landed"},
    {key:"pressure",    label:"Pressure sung/cast"},
    {key:"boost",       label:"Boost / Webby value"}
  ];

  // archetype signature pools
  const DWARVES = ["Doc","Grumpy","Happy","Sleepy","Bashful","Sneezy","Dopey","Merida"];
  const TOYS = ["Woody","Jessie","Bullseye","Hamm","Rex","Lenny","Bo Peep","Sarge","Grandmother Willow","Alien","Bullseye - Loyal Horse"];
  const LOC_NAMES = ["Zootopia","Island of Nomanisan","Castle Wyvern","Sleepy Hollow","Leviathan's Lair","Casa Madrigal","The Library","Police Headquarters"];
  const CONTROL = ["The Headless Horseman","Demona","Yzma","Hades","Cheshire Cat","Isis Vanderchill","Be King Undisputed","Elsa - The Fifth Spirit","Maui - Half-Shark","Olaf - Helping Hand"];
  const DETECTIVE = ["Basil","Magica","Clarice"];
  const PRINCESS = ["Cinderella","Aurora","Ariel","Belle","Tiana","Rapunzel","Moana","Fauna - Good-Natured Fairy","Tod"];
  const AGGRO_ARCH = {"Toys":1,"Dwarves":1,"Amber/Emerald Aggro":1,"Amber/Ruby Toys":1};
  const EVASIVE_ARCH = {"Amethyst/Sapphire Evasive":1,"Amber/Amethyst Evasive":1};
  const CONTROL_ARCH = {"Sapphire/Steel Control":1,"Emerald/Sapphire Control":1};

  function firstName(c){ return c.split(" - ")[0].trim(); }

  function parseLog(raw, deckList, options){
    options = options || {};
    const lines = raw.replace(/\r/g,"").split("\n").map(l=>l.trim()).filter(Boolean);
    const cards = {1:new Set(),2:new Set()};
    const playedBy = {1:new Set(),2:new Set()};
    const oppCards = new Set();          // opponent card names for archetype guess
    const add=(p,c)=>{ if(c) cards[p].add(c.trim()); };

    let firstTurnPlayer=null, curTurn=0, curPlayer=null;
    const mull={1:0,2:0};
    const lore={1:0,2:0};
    const loreByTurn={1:{},2:{}};
    const cross={1:{c10:null,c20:null},2:{c10:null,c20:null}};
    const firstQuest={1:null,2:null};
    const questers={1:{},2:{}};
    const turnsTaken={1:0,2:0};
    const abilByPlayer={1:new Set(),2:new Set()};
    const gastonLock={1:false,2:false};
    let winner=null, method="unknown";
    let loserBanish={1:0,2:0};           // bodies each player lost
    let lastChal=null;                   // {who, atk, def}
    let lastRemovalBy=null;              // player who just used a "banishes X" effect

    const reHand=/^Player (\d)'s starting hand:\s*(.+)$/;
    const reMull=/^Player (\d) mulliganed (\d+) cards?:\s*(.+?)\. Drew:\s*(.+)$/;
    const reKept=/^Player (\d) kept/;
    const reTurn=/^--- Turn (\d+) ---$/;
    const reBegin=/^Player (\d)'s turn begins$/;
    const rePlay=/^Player (\d) played (.+?) \(cost/;
    const reShift=/^Player (\d) shifted (.+?) onto/;
    const reQuest=/Player (\d) quested with (.+?) \(\+(\d+) \[LORE\], (\d+) -> (\d+)\)/;
    const reLoreArrow=/\[LORE\][^\d]*?(\d+) -> (\d+)/;
    const reBan=/^(.+?) was banished$/;
    const reChal=/^Player (\d) challenged (.+?) with (.+?)(?: \||$)/;
    const reBanishes=/banishes (.+?)$/;
    const reInkField=/^(.+?) was put into Player (\d)'s inkwell from field$/;
    const reWon=/^Player (\d) won/;
    const reConcede=/^Player (\d) conceded$/;
    const reWon20=/Player (\d) won with (\d+) \[LORE\]/;
    const reActivated=/activated ([A-Z][A-Z0-9'! ]+?) on /;
    const reAbil=/'s ([A-Z][A-Z0-9'! ]{2,}?) (?:draws|gives|deals|gains|removes|banishes|grants|returns|chose|had|puts|moves|Returned|drew|-)/;

    for(const ln of lines){
      let m;
      if(m=ln.match(reHand)){ m[2].split(",").forEach(c=>add(+m[1],c)); continue; }
      if(m=ln.match(reMull)){ mull[+m[1]]=+m[2]; m[4].split(",").forEach(c=>add(+m[1],c)); continue; }
      if(reKept.test(ln)){ continue; }
      if(m=ln.match(reTurn)){ curTurn=+m[1]; lastChal=null; lastRemovalBy=null; continue; }
      if(m=ln.match(reBegin)){ curPlayer=+m[1]; if(firstTurnPlayer===null)firstTurnPlayer=curPlayer; turnsTaken[curPlayer]++; continue; }
      if(m=ln.match(rePlay)){ add(+m[1],m[2]); playedBy[+m[1]].add(m[2].trim()); continue; }
      if(m=ln.match(reShift)){ add(+m[1],m[2]); playedBy[+m[1]].add(m[2].trim()); }
      // ability attribution to current player
      if(m=ln.match(reActivated)){ abilByPlayer[curPlayer]&&abilByPlayer[curPlayer].add(m[1].trim()); }
      if(m=ln.match(reAbil)){ if(curPlayer) abilByPlayer[curPlayer].add(m[1].trim()); }
      if(/TOP THAT!/.test(ln) && !/no effect/.test(ln) && !/not met/.test(ln) && curPlayer){ gastonLock[curPlayer]=true; }

      // quest (explicit player + lore)
      if(m=ln.match(reQuest)){
        const p=+m[1], name=m[2].trim(), gained=+m[3], nv=+m[5];
        lore[p]=nv; loreByTurn[p][curTurn]=nv;
        questers[p][name]=(questers[p][name]||0)+gained;
        if(firstQuest[p]===null) firstQuest[p]=curTurn;
        if(nv>=10&&cross[p].c10===null)cross[p].c10=curTurn;
        if(nv>=20&&cross[p].c20===null)cross[p].c20=curTurn;
        continue;
      }
      // any other lore change (passive locations, gains) -> active player
      if(/\[LORE\]/.test(ln) && (m=ln.match(reLoreArrow)) && curPlayer){
        const nv=+m[2];
        if(nv>=lore[curPlayer]){ lore[curPlayer]=nv; loreByTurn[curPlayer][curTurn]=nv;
          if(nv>=10&&cross[curPlayer].c10===null)cross[curPlayer].c10=curTurn;
          if(nv>=20&&cross[curPlayer].c20===null)cross[curPlayer].c20=curTurn; }
        continue;
      }
      // board control bookkeeping
      if(m=ln.match(reChal)){ lastChal={who:+m[1], def:m[2].trim(), atk:m[3].trim().replace(/ \|.*$/,"")}; lastRemovalBy=null; continue; }
      if(reBanishes.test(ln)){ lastRemovalBy=curPlayer; continue; }
      if(m=ln.match(reInkField)){ loserBanish[+m[2]]++; continue; }
      if(m=ln.match(reBan)){
        const X=m[1].trim(); let loser=null;
        if(lastRemovalBy){ loser = lastRemovalBy===1?2:1; lastRemovalBy=null; }
        else if(lastChal && X===lastChal.def){ loser = lastChal.who===1?2:1; }
        else if(lastChal && X===lastChal.atk){ loser = lastChal.who; }
        else { loser = curPlayer ? (curPlayer===1?2:1) : null; } // default: active player removed opp body
        if(loser) loserBanish[loser]++;
        continue;
      }
      if(m=ln.match(reConcede)){ method="concession"; continue; }
      if(m=ln.match(reWon20)){ winner=+m[1]; lore[+m[1]]=Math.max(lore[+m[1]],+m[2]); if(method==="unknown")method="20 lore"; continue; }
      if(m=ln.match(reWon)){ winner=+m[1]; if(/concession/.test(ln))method="concession"; continue; }
    }

    // identify me
    const DL=(deckList&&deckList.length)?deckList:DECK;
    const inDL=c=>DL.some(d=>c===d||c.split(" - ")[0].trim()===d.split(" - ")[0].trim());
    const score=p=>[...cards[p]].filter(inDL).length;
    const me = score(1)>=score(2)?1:2; const opp = me===1?2:1;
    // opponent cards for archetype
    cards[opp].forEach(c=>oppCards.add(c));

    const result = winner!==null ? (winner===me?"W":"L") : "W";

    // combos for me
    const A=abilByPlayer[me], P=playedBy[me];
    const combos={
      dale:        P.has("Dale - Ready for His Shot"),
      mulanElite:  P.has("Mulan - Elite Archer"),
      tripleShot:  A.has("TRIPLE SHOT"),
      sword:       A.has("WORTHY WEAPON"),
      ohana:       A.has("OHANA MEANS FAMILY")||A.has("OHANA"),
      reuben:      A.has("LUNCH SPECIAL"),
      snowboarder: A.has("BRING YOUR FRIENDS"),
      gastonLock:  gastonLock[me],
      pressure:    P.has("This Growing Pressure")||A.has("THIS GROWING PRESSURE"),
      boost:       A.has("LATEST ENTRY")||/boosted/.test("") // boost handled below
    };
    // boost: scan raw for "Player me boosted"
    combos.boost = combos.boost || new RegExp("Player "+me+" boosted").test(raw);

    // archetype guess
    const oc=[...oppCards].map(firstName);
    const ocFull=[...oppCards];
    const hasPassiveLoc = /Set step: .+ grants Player/.test(raw) && !( /Set step: .+ grants Player "+me/.test(raw));
    let arch="Other / Unknown";
    const controlHits = CONTROL.filter(c=>ocFull.some(o=>o.includes(c)||o.startsWith(c))).length;
    const locCards = LOC_NAMES.filter(l=>ocFull.some(c=>c.includes(l))).length;
    const oppPassiveLore = new RegExp("Set step: [^\\n]+grants Player "+opp).test(raw);
    if(DWARVES.filter(d=>oc.includes(d)).length>=2) arch="Dwarves";
    else if(["Woody","Jessie","Bullseye","Hamm","Rex","Lenny"].filter(d=>oc.includes(d)).length>=2 || (oc.includes("Grandmother Willow")&&oc.includes("Woody"))) arch="Toys";
    else if(controlHits>=2) arch="Sapphire/Steel Control";          // control before locations: a splashed Library shouldn't read as Locations
    else if(locCards>=2 || oppPassiveLore) arch="Locations";
    else if(PRINCESS.some(pp=>ocFull.some(o=>o===pp||o.startsWith(firstName(pp))))) arch="Princesses";
    else if(DETECTIVE.filter(d=>oc.includes(d)).length>=2) arch="Detective";

    const myTurns=turnsTaken[me]||1;
    const cross10MyTurn = cross[me].c10? Math.ceil(cross[me].c10/2):null;
    const firstQuestMyTurn = firstQuest[me]? Math.ceil(firstQuest[me]/2):null;

    // category guess
    let winCat="", lossCat="";
    if(result==="W"){
      if(combos.tripleShot) winCat="Dale + Mulan board clear";
      else if(method==="concession") winCat="Opponent conceded behind";
      else winCat="Out-raced (go-wide tempo)";
    } else {
      if(arch==="Locations") lossCat="Locations ticked me out";
      else if(arch==="Sapphire/Steel Control") lossCat="Out-removed by control";
      else if(arch==="Toys"||arch==="Dwarves") lossCat=(lore[me]<=2?"Never built a clock":"Couldn't stabilize vs aggro");
      else if(lore[me]>=15) lossCat="Out-removed by control";
      else lossCat="Never built a clock";
    }

    const game = {
      id:"g"+Math.random().toString(36).slice(2,9),
      dateAdded:new Date().toISOString().slice(0,10),
      me, onPlay: firstTurnPlayer===me, mulligan: mull[me],
      myLore: lore[me], oppLore: lore[opp], margin: lore[me]-lore[opp],
      cross10: cross[me].c10, cross20: cross[me].c20,
      cross10MyTurn, firstQuest: firstQuest[me], firstQuestMyTurn,
      myTurns, gameTurns: curTurn, lorePerTurn:+(lore[me]/myTurns).toFixed(2),
      result, method,
      removedByMe: loserBanish[opp], myLost: loserBanish[me],
      questers: questers[me], combos,
      loreByTurn: loreByTurn[me], oppLoreByTurn: loreByTurn[opp],
      oppCards: [...oppCards].sort(),
      archetype: arch, winCat, lossCat, venue:"", notes:"",
      rawLog: raw
    };

    // ---- Match coach layer (parserVersion 2) — deterministic, no external AI ----
    attachCoachLayer(game, raw, options);
    return game;
  }

  // ---------- Replay: turn-by-turn event breakdown from a raw log ----------
  // Only surfaces what the log actually contains — plays, quests, challenges,
  // banishes, ink-from-field, mulligans, concede/win. No inferred hand/ink state.
  // Each turn also carries a cumulative `board` snapshot {1:{playZone,inkCount,handCount},2:{...}}
  // built ONLY from log-confirmed events — anything the log can't support stays null ("?").
  function buildReplay(raw, deckList){
    const lines = String(raw||"").replace(/\r/g,"").split("\n").map(l=>l.trim()).filter(Boolean);
    const cards = {1:new Set(),2:new Set()};
    const add=(p,c)=>{ if(c) cards[p].add(c.trim()); };

    const reHand=/^Player (\d)'s starting hand:\s*(.+)$/;
    const reMull=/^Player (\d) mulliganed (\d+) cards?:\s*(.+?)\. Drew:\s*(.+)$/;
    const reTurn=/^--- Turn (\d+) ---$/;
    const reBegin=/^Player (\d)'s turn begins$/;
    const rePlay=/^Player (\d) played (.+?) \(cost (\d+)\)$/;
    const reShift=/^Player (\d) shifted (.+?) onto (.+)$/;
    const reQuest=/^Player (\d) quested with (.+?) \(\+(\d+) \[LORE\], (\d+) -> (\d+)\)/;
    const reBan=/^(.+?) was banished$/;
    const reChal=/^Player (\d) challenged (.+?) with (.+?)(?: \||$)/;
    const reBanishes=/banishes (.+?)$/;
    const reInkField=/^(.+?) was put into Player (\d)'s inkwell from field$/;
    const reInkHand=/^Player (\d) put (.+?) into (?:their|his|her) inkwell$/;
    const reWon=/^Player (\d) won/;
    const reConcede=/^Player (\d) conceded$/;
    const reWon20=/Player (\d) won with (\d+) \[LORE\]/;

    const startingHands={1:[],2:[]};
    const mulligans={1:null,2:null};
    const turns=[]; // {turn, player, events:[{type,text}]}
    let curTurnObj=null, curPlayer=null, curTurn=0;
    const lore={1:0,2:0};
    const pushEvt=(type,text)=>{ if(curTurnObj) curTurnObj.events.push({type,text}); };

    // Cumulative board state — only advanced by lines the log actually contains.
    const playZone={1:[],2:[]};       // names currently on board (best-effort; shifts don't change count)
    const inkCount={1:0,2:0};         // known ink events only (log doesn't record routine hand->ink each turn)
    const knownHandCount={1:null,2:null}; // only trustworthy right after starting hand / mulligan; unknown afterward
    let lastChal=null, lastRemovalBy=null;
    const removeFromZone=(p,name)=>{ const i=playZone[p].indexOf(name); if(i>=0) playZone[p].splice(i,1); };
    const stampBoard=()=>{ if(!curTurnObj) return; curTurnObj.board = {
      1:{ playZone:playZone[1].slice(), inkCount:inkCount[1], handCount:knownHandCount[1] },
      2:{ playZone:playZone[2].slice(), inkCount:inkCount[2], handCount:knownHandCount[2] }
    }; };

    for(const ln of lines){
      let m;
      if(m=ln.match(reHand)){ const p=+m[1]; const list=m[2].split(",").map(c=>c.trim()).filter(Boolean); startingHands[p]=list; list.forEach(c=>add(p,c)); knownHandCount[p]=list.length; continue; }
      if(m=ln.match(reMull)){
        const p=+m[1], n=+m[2], drew=m[4].split(",").map(c=>c.trim()).filter(Boolean);
        mulligans[p]={count:n, mulliganed:m[3].split(",").map(c=>c.trim()).filter(Boolean), drew};
        drew.forEach(c=>add(p,c));
        knownHandCount[p]=(knownHandCount[p]||0)-n+drew.length;
        continue;
      }
      if(m=ln.match(reTurn)){
        curTurn=+m[1];
        curTurnObj={ turn:curTurn, player:null, events:[], loreSnapshot:null, board:null };
        turns.push(curTurnObj);
        lastChal=null; lastRemovalBy=null;
        continue;
      }
      if(m=ln.match(reBegin)){ curPlayer=+m[1]; if(curTurnObj) curTurnObj.player=curPlayer; continue; }
      if(m=ln.match(rePlay)){ const p=+m[1]; add(p,m[2]); playZone[p].push(m[2].trim()); if(knownHandCount[p]!=null) knownHandCount[p]=Math.max(0,knownHandCount[p]-1); pushEvt('play', 'Player '+p+' played '+m[2].trim()+' (cost '+m[3]+')'); stampBoard(); continue; }
      if(m=ln.match(reShift)){ const p=+m[1]; add(p,m[2]); playZone[p].push(m[2].trim()); if(knownHandCount[p]!=null) knownHandCount[p]=Math.max(0,knownHandCount[p]-1); pushEvt('play', 'Player '+p+' shifted '+m[2].trim()+' onto '+m[3].trim()); stampBoard(); continue; }
      if(m=ln.match(reQuest)){
        const p=+m[1], name=m[2].trim(), gained=+m[3], nv=+m[5];
        lore[p]=nv;
        pushEvt('quest', 'Player '+p+' quested with '+name+' (+'+gained+' lore, now '+nv+')');
        continue;
      }
      if(m=ln.match(reChal)){ lastChal={who:+m[1], def:m[2].trim(), atk:m[3].trim().replace(/ \|.*$/,"")}; lastRemovalBy=null; pushEvt('challenge', 'Player '+m[1]+' challenged '+m[2].trim()+' with '+m[3].trim().replace(/ \|.*$/,'')); continue; }
      if(reBanishes.test(ln)){ lastRemovalBy=curPlayer; continue; }
      if(m=ln.match(reInkField)){ const owner=+m[2]; inkCount[owner]++; removeFromZone(owner===1?2:1, m[1].trim()); removeFromZone(owner, m[1].trim()); pushEvt('ink', m[1].trim()+' was put into Player '+m[2]+"'s inkwell from field"); stampBoard(); continue; }
      if(m=ln.match(reInkHand)){ const p=+m[1]; inkCount[p]++; if(knownHandCount[p]!=null) knownHandCount[p]=Math.max(0,knownHandCount[p]-1); pushEvt('ink', 'Player '+p+' put '+m[2].trim()+' into their inkwell'); stampBoard(); continue; }
      if(m=ln.match(reBan)){
        const X=m[1].trim(); let loser=null;
        if(lastRemovalBy){ loser = lastRemovalBy===1?2:1; }
        else if(lastChal && X===lastChal.def){ loser = lastChal.who===1?2:1; }
        else if(lastChal && X===lastChal.atk){ loser = lastChal.who; }
        else { loser = curPlayer ? (curPlayer===1?2:1) : null; }
        if(loser){ removeFromZone(loser, X); removeFromZone(loser===1?2:1, X); }
        pushEvt('banish', X+' was banished');
        stampBoard();
        continue;
      }
      if(m=ln.match(reConcede)){ pushEvt('concede', 'Player '+m[1]+' conceded'); continue; }
      if(m=ln.match(reWon20)){ pushEvt('win', 'Player '+m[1]+' won with '+m[2]+' lore'); continue; }
      if(m=ln.match(reWon)){ pushEvt('win', 'Player '+m[1]+' won'); continue; }
    }
    // stamp cumulative lore at end of each turn for a running scoreline
    let l1=0,l2=0;
    turns.forEach(t=>{
      t.events.forEach(e=>{
        const mq=e.text.match(/^Player (\d) quested.*now (\d+)\)$/);
        if(mq){ if(+mq[1]===1) l1=+mq[2]; else l2=+mq[2]; }
      });
      t.loreSnapshot={1:l1,2:l2};
    });
    // forward-fill board snapshots onto turns that had no zone-mutating events
    let lastBoard={ 1:{playZone:[],inkCount:0,handCount:knownHandCount[1]}, 2:{playZone:[],inkCount:0,handCount:knownHandCount[2]} };
    turns.forEach(t=>{ if(t.board) lastBoard=t.board; else t.board=lastBoard; });

    const DL=(deckList&&deckList.length)?deckList:DECK;
    const inDL=c=>DL.some(d=>c===d||c.split(" - ")[0].trim()===d.split(" - ")[0].trim());
    const score=p=>[...cards[p]].filter(inDL).length;
    const me = score(1)>=score(2)?1:2;

    return { me, startingHands, mulligans, turns };
  }

  // ---------- rawHash: deterministic, non-crypto, used only for dup detection ----------
  function rawHash(raw){
    const s = String(raw||"").replace(/\s+/g," ").trim();
    let h1=0x811c9dc5, h2=0x9e3779b9;
    for(let i=0;i<s.length;i++){
      const c=s.charCodeAt(i);
      h1 = (h1 ^ c); h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + c) >>> 0; h2 = ((h2<<5) ^ (h2>>>2) ^ c) >>> 0;
    }
    return (h1>>>0).toString(16).padStart(8,"0") + (h2>>>0).toString(16).padStart(8,"0") + s.length.toString(16);
  }

  // ---------- Strategy text -> structured hints ----------
  function parseStrategyHints(text, deckList){
    const hints = { archetypeHint:null, targetFirstQuestTurn:null, targetCross10Turn:null, targetCloseTurn:null,
      keyCards:[], winHint:'', lossHint:'', warnings:[] };
    const original = String(text||'');
    if(!original.trim()) return hints;
    const t = original.toLowerCase();

    const archs = ['aggro','tempo','control','midrange','combo','grind','locations','evasive'];
    for(const a of archs){ if(t.includes(a)){ hints.archetypeHint=a; break; } }

    let m = t.match(/cross(?:es|ing)?\s*(?:10|ten)[^\d]{0,18}(?:turn|t)\s*(\d+)/) || t.match(/(?:turn|t)\s*(\d+)[^\d]{0,12}cross(?:es|ing)?\s*(?:10|ten)/);
    if(m) hints.targetCross10Turn = +m[1];
    m = t.match(/first\s*quest[^\d]{0,18}(?:turn|t)\s*(\d+)/) || t.match(/quest(?:ing)?\s*from\s*(?:turn|t)\s*(\d+)/);
    if(m) hints.targetFirstQuestTurn = +m[1];
    m = t.match(/close(?:s|ing)?[^\d]{0,22}(?:by\s*)?(?:turn|t)\s*(\d+)/) || t.match(/(?:by\s*)?(?:turn|t)\s*(\d+)[^\d]{0,12}(?:close|win)/);
    if(m) hints.targetCloseTurn = +m[1];

    // key cards named in the strategy — match against this deck's card list
    if(deckList && deckList.length){
      const seen=new Set();
      deckList.forEach(full=>{
        const name = firstName(full||'');
        if(name && name.length>2 && original.toLowerCase().includes(name.toLowerCase()) && !seen.has(name)){
          seen.add(name); hints.keyCards.push(name);
        }
      });
    }

    m = original.match(/[^.]*\bwins?\b[^.]*\./i);
    if(m) hints.winHint = m[0].trim();
    m = original.match(/[^.]*\bloses?\b[^.]*\./i);
    if(m) hints.lossHint = m[0].trim();

    const warnPhrases = ['do not overcommit',"don't overcommit",'preserve a second wave','preserve second wave',
      'race before removal stabilizes','do not overextend',"don't overextend",'save your removal','play around',
      'do not durdle',"don't durdle",'bait removal'];
    warnPhrases.forEach(p=>{ if(t.includes(p)) hints.warnings.push(original.substring(t.indexOf(p), t.indexOf(p)+p.length)); });

    return hints;
  }

  // ---------- Win condition classifier ----------
  function classifyWinCondition(game, hints){
    hints = hints || {};
    const ev=[];
    if(game.result!=="W") return { primary:"", secondary:"", evidence:[], confidence:0 };

    if(game.method==="concession"){
      ev.push(`Opponent conceded at ${game.oppLore} lore while you were at ${game.myLore}.`);
      return { primary:"Opponent conceded behind", secondary:"", evidence:ev, confidence:0.85 };
    }

    const comboHit = game.combos && Object.keys(game.combos).find(k=>game.combos[k] && ["tripleShot","sword","pressure","gastonLock"].includes(k));
    if(comboHit){
      ev.push(`Combo flag "${comboHit}" fired and you closed the game.`);
      return { primary:"Combo payoff", secondary:"Board control into lore", evidence:ev, confidence:0.7 };
    }

    if(game.removedByMe>=4 && game.margin>0){
      ev.push(`Removed ${game.removedByMe} opposing bodies while keeping a lore lead of ${game.margin}.`);
      return { primary:"Board control into lore", secondary:"Removal lock", evidence:ev, confidence:0.65 };
    }

    if(game.firstQuestMyTurn && game.firstQuestMyTurn<=3 && game.cross10MyTurn && game.cross10MyTurn<=6){
      ev.push(`First quest on your turn ${game.firstQuestMyTurn}, crossed 10 lore by your turn ${game.cross10MyTurn}.`);
      return { primary:"Fast lore race", secondary:"", evidence:ev, confidence:0.7 };
    }

    if(game.cross10MyTurn){
      ev.push(`Crossed 10 lore by your turn ${game.cross10MyTurn} and closed from there.`);
      return { primary:"Steady lore clock", secondary:"", evidence:ev, confidence:0.6 };
    }

    if(game.removedByMe>=2){
      ev.push(`Removed ${game.removedByMe} bodies to deny the opponent's clock.`);
      return { primary:"Removal lock", secondary:"", evidence:ev, confidence:0.5 };
    }

    if(Object.keys(game.questers||{}).length<=1 && game.myLore>=10){
      ev.push("Lore climbed with barely any tracked quests — likely a location or passive source.");
      return { primary:"Location/passive lore", secondary:"", evidence:ev, confidence:0.4 };
    }

    if(game.gameTurns>=24){
      ev.push(`Game ran ${game.gameTurns} turns — a long grind to close it out.`);
      return { primary:"Resource grind", secondary:"", evidence:ev, confidence:0.45 };
    }

    ev.push("No single dominant signal in the log — worth a manual look.");
    return { primary:"Unknown / manual review", secondary:"", evidence:ev, confidence:0.25 };
  }

  // ---------- Loss condition classifier ----------
  function classifyLossCondition(game, hints){
    hints = hints || {};
    const ev=[];
    if(game.result!=="L") return { primary:"", secondary:"", evidence:[], confidence:0 };

    if(game.myLore<5){
      ev.push(`Finished at only ${game.myLore} lore — the clock never really started.`);
      if(hints.targetCross10Turn) ev.push(`Strategy targets crossing 10 by turn ${hints.targetCross10Turn}; you never crossed 10.`);
      return { primary:"Never built a lore clock", secondary:"", evidence:ev, confidence:0.75 };
    }

    if(game.removedByMe>=4 && game.myLore<12){
      ev.push(`Removed ${game.removedByMe} bodies but only reached ${game.myLore} lore — winning combat, not the race.`);
      return { primary:"Too much control, not enough questing", secondary:"", evidence:ev, confidence:0.65 };
    }

    if(AGGRO_ARCH[game.archetype]){
      ev.push(`Opponent read as ${game.archetype} — a fast board that likely out-turned you.`);
      return { primary:"Out-raced by aggro", secondary:"", evidence:ev, confidence:0.55 };
    }
    if(EVASIVE_ARCH[game.archetype]){
      ev.push(`Opponent read as ${game.archetype} — evasive bodies are hard to block/challenge.`);
      return { primary:"Out-raced by evasives", secondary:"", evidence:ev, confidence:0.55 };
    }
    if(CONTROL_ARCH[game.archetype]){
      ev.push(`Opponent read as ${game.archetype} — likely removed your board piece by piece.`);
      return { primary:"Out-removed by control", secondary:"", evidence:ev, confidence:0.55 };
    }
    if(game.archetype==="Locations"){
      ev.push("Opponent read as Locations — passive lore that doesn't trade in combat.");
      return { primary:"Locations ticked me out", secondary:"", evidence:ev, confidence:0.55 };
    }

    if(hints.keyCards && hints.keyCards.length && game.combos){
      const missing = !Object.keys(game.combos).some(k=>game.combos[k]);
      if(missing){
        ev.push(`Strategy names ${hints.keyCards.slice(0,3).join(', ')} but no combo flags fired this game.`);
        return { primary:"Combo never came online", secondary:"", evidence:ev, confidence:0.45 };
      }
    }

    if(game.mulligan>=4 && game.firstQuestMyTurn && game.firstQuestMyTurn>=5){
      ev.push(`Mulliganed ${game.mulligan} cards and didn't quest until your turn ${game.firstQuestMyTurn}.`);
      return { primary:"Bad mulligan / slow start", secondary:"", evidence:ev, confidence:0.5 };
    }

    if(game.myLore>=15){
      ev.push(`Reached ${game.myLore} lore before losing — the plan mostly worked, the close didn't.`);
      return { primary:"Could not close after stabilizing", secondary:"", evidence:ev, confidence:0.55 };
    }

    if(Object.keys(game.questers||{}).length===0){
      ev.push("No tracked quests at all — likely flooded or missing threats in hand.");
      return { primary:"Flooded / drew no threats", secondary:"", evidence:ev, confidence:0.5 };
    }

    if(hints.targetFirstQuestTurn && game.firstQuestMyTurn && game.firstQuestMyTurn>hints.targetFirstQuestTurn){
      ev.push(`Strategy targets first quest by turn ${hints.targetFirstQuestTurn}; first quest landed on turn ${game.firstQuestMyTurn}.`);
      return { primary:"Too much control, not enough questing", secondary:"", evidence:ev, confidence:0.4 };
    }

    ev.push("No single dominant signal in the log — worth a manual look.");
    return { primary:"Unknown / manual review", secondary:"", evidence:ev, confidence:0.25 };
  }

  // ---------- Plan score (0-100) ----------
  function computePlanScore(game, hints){
    hints = hints || {};
    let score = 70;
    const reasons = [];
    let hadTarget = false;

    if(hints.targetCross10Turn){
      hadTarget = true;
      if(game.cross10MyTurn!=null){
        const diff = game.cross10MyTurn - hints.targetCross10Turn;
        if(diff<=0){ score+=10; reasons.push(`Crossed 10 lore on turn ${game.cross10MyTurn}, at or ahead of your turn-${hints.targetCross10Turn} target.`); }
        else { score-=Math.min(22, diff*4); reasons.push(`Crossed 10 lore on turn ${game.cross10MyTurn}, ${diff} turn(s) behind your turn-${hints.targetCross10Turn} target.`); }
      } else {
        score-=25; reasons.push(`Never crossed 10 lore — target was turn ${hints.targetCross10Turn}.`);
      }
    }
    if(hints.targetFirstQuestTurn){
      hadTarget = true;
      if(game.firstQuestMyTurn!=null){
        const diff = game.firstQuestMyTurn - hints.targetFirstQuestTurn;
        if(diff<=0){ score+=8; reasons.push(`First quest landed on turn ${game.firstQuestMyTurn}, on schedule.`); }
        else { score-=Math.min(18, diff*3); reasons.push(`First quest landed on turn ${game.firstQuestMyTurn}, ${diff} turn(s) late.`); }
      } else {
        score-=15; reasons.push("Never recorded a quest.");
      }
    }
    if(hints.targetCloseTurn && game.result==="W"){
      const myCloseTurn = game.cross20MyTurn || (game.myTurns||null);
      if(myCloseTurn && myCloseTurn<=hints.targetCloseTurn){ score+=8; reasons.push(`Closed by your turn ${myCloseTurn}, inside the turn-${hints.targetCloseTurn} target.`); }
    }

    if(game.result==="W"){
      if(game.margin!=null && game.margin<3){ score-=5; reasons.push("Won, but by a thin margin — plan execution could be tighter."); }
    } else {
      if(!hadTarget){
        // no explicit targets in the strategy — judge on general clock health
        if(game.myLore>=10){ score+=5; reasons.push("Lost, but the lore clock was actually running (10+ lore) — a matchup/cards loss, not a plan failure."); }
        else { score-=10; reasons.push("Lost with a clock that never got going."); }
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const label = score>=80?"On plan":score>=50?"Partly on plan":"Off plan";
    return { score, label, reasons };
  }

  // ---------- Key turning points ----------
  function keyTurningPoints(game){
    const pts=[];
    if(game.firstQuest!=null){
      pts.push({ turn:game.firstQuest, label:"First quest", evidence:`Your first quest landed on turn ${game.firstQuest} (your turn ${game.firstQuestMyTurn}).`, impact:"positive" });
    }
    if(game.cross10!=null){
      pts.push({ turn:game.cross10, label:"Crossed 10 lore", evidence:`Reached 10 lore on turn ${game.cross10} (your turn ${game.cross10MyTurn}).`, impact:"positive" });
    }
    const myLBT=game.loreByTurn||{}, oppLBT=game.oppLoreByTurn||{};
    const bigJump=(byTurn,label,impact)=>{
      let prev=0;
      Object.keys(byTurn).map(Number).sort((a,b)=>a-b).forEach(turn=>{
        const v=byTurn[turn], delta=v-prev;
        if(delta>=5) pts.push({ turn, label, evidence:`+${delta} lore in one step (turn ${turn}), reaching ${v}.`, impact });
        prev=v;
      });
    };
    bigJump(myLBT, "Big lore swing (you)", "positive");
    bigJump(oppLBT, "Big lore swing (opponent)", "negative");
    if(game.combos){
      Object.keys(game.combos).forEach(k=>{ if(game.combos[k]) pts.push({ turn:null, label:"Combo: "+k, evidence:`Combo flag "${k}" fired.`, impact:"positive" }); });
    }
    if(game.removedByMe>=3) pts.push({ turn:null, label:"Heavy removal", evidence:`Removed ${game.removedByMe} opposing bodies.`, impact:"positive" });
    if(game.myLost>=4) pts.push({ turn:null, label:"Heavy losses", evidence:`Lost ${game.myLost} of your own bodies.`, impact:"negative" });
    // sort by turn (nulls last), cap at 6
    pts.sort((a,b)=>(a.turn==null)-(b.turn==null) || (a.turn||0)-(b.turn||0));
    return pts.slice(0,6);
  }

  // ---------- Coach report ----------
  const MATCHUP_TIPS = {
    "Toys":"Against go-wide Toys, stabilize first — don't trade one-for-one into a wider board, then wipe with your best combat turn.",
    "Dwarves":"Against Dwarves, don't durdle early; they can curve out fast. Lock their best enabler before clearing.",
    "Sapphire/Steel Control":"Against control, bait removal with mid-value bodies before committing your best threats; preserve a second wave.",
    "Emerald/Sapphire Control":"Against control, play around a wipe — don't overcommit your whole hand in one turn.",
    "Locations":"Against Locations, pressure the location-support characters early or race harder — locations don't trade in combat.",
    "Princesses":"Against Princesses, save your best removal for their evasive or Ward-protected threats.",
    "Amethyst/Sapphire Evasive":"Against evasive decks, race with your own clock — ground removal often can't reach them.",
    "Amber/Amethyst Evasive":"Against evasive decks, prioritize removing their support pieces since the evasive bodies dodge blocks.",
    "Amber/Emerald Aggro":"Against aggro, stabilize the board before turn 4-5, then take over with your own plan.",
    "Detective":"Against value/Detective decks, apply pressure so they're forced to answer instead of developing."
  };

  function buildCoachReport(game, hints, winCond, lossCond, planScore, options){
    hints = hints||{}; options = options||{};
    const whatWorked=[], whatFailed=[], nextGameFocus=[], deckImprovementIdeas=[];
    let headline='', summary='', mulliganAdvice='', matchupAdvice='';

    if(game.result==="W"){
      headline = `Win via ${winCond.primary||'unclear conditions'}`;
      summary = `You beat ${game.archetype} at ${game.myLore}-${game.oppLore}. ${(winCond.evidence||[])[0]||''}`.trim();
      whatWorked.push(...(winCond.evidence||[]));
      if(planScore.score<70) whatFailed.push("Won, but off the plan's own targets — see plan score reasons.");
      nextGameFocus.push(planScore.score<70 ? "Tighten execution toward your saved strategy's turn targets next game." : "Keep repeating this line — it matched your saved strategy.");
    } else {
      headline = `Loss via ${lossCond.primary||'unclear conditions'}`;
      summary = `You lost to ${game.archetype} at ${game.myLore}-${game.oppLore}. ${(lossCond.evidence||[])[0]||''}`.trim();
      whatFailed.push(...(lossCond.evidence||[]));
      if(game.removedByMe>=2) whatWorked.push(`Still removed ${game.removedByMe} opposing bodies before losing.`);
      if(game.cross10MyTurn) whatWorked.push(`Did cross 10 lore (your turn ${game.cross10MyTurn}) before losing.`);
      if(lossCond.primary==="Never built a lore clock") nextGameFocus.push("Prioritize your first quest over board answers in the opening turns.");
      else if(lossCond.primary==="Too much control, not enough questing") nextGameFocus.push("Once the board is safe, redirect removal-holding characters into questing.");
      else if(lossCond.primary==="Could not close after stabilizing") nextGameFocus.push("Once ahead on lore, prioritize closing over grinding extra value.");
      else nextGameFocus.push("Re-tag this game's loss reason by hand if the guess looks off, then watch for the pattern repeating.");
    }

    mulliganAdvice = game.mulligan>=4
      ? "You mulliganed heavily this game — consider keeping slightly looser hands if this keeps happening."
      : (game.mulligan===0 && game.firstQuestMyTurn && game.firstQuestMyTurn>=5)
        ? "Kept the opening hand with no mulligan but still had a slow start — worth mulliganing more aggressively for early plays."
        : "Mulligan count looked reasonable for this game.";

    matchupAdvice = MATCHUP_TIPS[game.archetype] || "Log a few more games against this archetype to build a specific read.";

    if(hints.warnings && hints.warnings.length){
      nextGameFocus.push("Strategy reminder: "+hints.warnings[0]+".");
    }

    // repeated-pattern deck-improvement ideas, using prior games if provided
    const prior = (options.existingGames||[]).filter(g=>g && g.result);
    if(prior.length>=4){
      const losses = prior.filter(g=>g.result==="L");
      if(losses.length>=3){
        const sameLossCount = losses.filter(g=>(g.lossCondition&&g.lossCondition.primary)===lossCond.primary && lossCond.primary).length;
        if(lossCond.primary && sameLossCount>=2){
          deckImprovementIdeas.push(`"${lossCond.primary}" has shown up in ${sameLossCount+1} losses now — consider a tech change or sideboard plan for it.`);
        }
        const neverClock = losses.filter(g=>(g.myLore||0)<5).length;
        if(neverClock>=3) deckImprovementIdeas.push(`${neverClock} losses ended under 5 lore — the deck may want a faster or more resilient opening.`);
      }
    }

    const confidence = Math.round((((winCond.confidence||0)+(lossCond.confidence||0)) * (game.result==="W"?1:1) + (planScore.score/100)) / 2 * 100) / 100;

    return {
      headline, summary,
      whatWorked, whatFailed, nextGameFocus,
      mulliganAdvice, matchupAdvice, deckImprovementIdeas,
      confidence: Math.max(0, Math.min(1, confidence))
    };
  }

  // ---------- Attach the whole coach layer onto a freshly parsed game ----------
  function attachCoachLayer(game, raw, options){
    options = options || {};
    const deckList = options.deckList || null;
    const hints = parseStrategyHints(options.deckStrategy||'', deckList);
    const winCondition = classifyWinCondition(game, hints);
    const lossCondition = classifyLossCondition(game, hints);
    const planScore = computePlanScore(game, hints);
    const turningPoints = keyTurningPoints(game);
    const coach = buildCoachReport(game, hints, winCondition, lossCondition, planScore, options);

    game.parserVersion = 2;
    game.rawHash = rawHash(raw);
    game.planScore = planScore;
    game.winCondition = winCondition;
    game.lossCondition = lossCondition;
    game.keyTurningPoints = turningPoints;
    game.coach = coach;

    if(options.existingGames && options.existingGames.length){
      const dup = options.existingGames.find(g=>g && g.rawHash && g.rawHash===game.rawHash);
      game.isDuplicateOfId = dup ? dup.id : null;
    } else {
      game.isDuplicateOfId = null;
    }
    return game;
  }

  // ---------- Batch parsing (low-risk helper) ----------
  function parseManyLogs(rawText, deckList, options){
    options = options || {};
    const out = { games:[], errors:[], duplicates:[] };
    const chunks = String(rawText||"").split(/\n{3,}/).map(c=>c.trim()).filter(Boolean);
    const existing = (options.existingGames||[]).slice();
    chunks.forEach((chunk, idx)=>{
      try{
        const g = parseLog(chunk, deckList, {...options, existingGames: existing.concat(out.games)});
        if(g.isDuplicateOfId){ out.duplicates.push(g); }
        else { out.games.push(g); }
      }catch(e){
        out.errors.push({ index:idx, message:(e&&e.message)||String(e) });
      }
    });
    return out;
  }

  // ---------- Self-test ----------
  function runParserSelfTest(){
    const results=[];
    const assert=(name, cond, detail)=>results.push({name, pass:!!cond, detail:detail||''});
    const L=(...lines)=>lines.join("\n");

    // 1. Win by concession
    try{
      const raw1 = L(
        "Player 1's starting hand: Dale - Ready for His Shot",
        "Player 2's starting hand: Woody",
        "--- Turn 1 ---","Player 1's turn begins",
        "Player 1 played Dale - Ready for His Shot (cost 3)",
        "--- Turn 2 ---","Player 2's turn begins",
        "--- Turn 3 ---","Player 1's turn begins",
        "Player 1 quested with Dale - Ready for His Shot (+5 [LORE], 0 -> 5)",
        "--- Turn 4 ---","Player 2's turn begins",
        "Player 2 conceded","Player 1 won"
      );
      const g1 = parseLog(raw1, DECK, { deckStrategy:'' });
      assert("1. win by concession", g1.result==="W" && g1.winCondition.primary==="Opponent conceded behind", JSON.stringify({result:g1.result, win:g1.winCondition.primary}));
    }catch(e){ assert("1. win by concession", false, String(e)); }

    // 2. Win by 20 lore
    try{
      const raw2 = L(
        "Player 1's starting hand: Dale - Ready for His Shot",
        "Player 2's starting hand: Woody",
        "--- Turn 1 ---","Player 1's turn begins",
        "--- Turn 2 ---","Player 2's turn begins",
        "--- Turn 3 ---","Player 1's turn begins",
        "Player 1 quested with Dale - Ready for His Shot (+10 [LORE], 0 -> 10)",
        "--- Turn 4 ---","Player 2's turn begins",
        "--- Turn 5 ---","Player 1's turn begins",
        "Player 1 quested with Dale - Ready for His Shot (+10 [LORE], 10 -> 20)",
        "Player 1 won with 20 [LORE]"
      );
      const g2 = parseLog(raw2, DECK, { deckStrategy:'' });
      assert("2. win by 20 lore", g2.result==="W" && !!g2.winCondition.primary, JSON.stringify({result:g2.result, win:g2.winCondition.primary}));
    }catch(e){ assert("2. win by 20 lore", false, String(e)); }

    // 3. Loss with late first quest / low final lore
    try{
      const raw3 = L(
        "Player 1's starting hand: Dale - Ready for His Shot",
        "Player 2's starting hand: Woody",
        "--- Turn 1 ---","Player 1's turn begins",
        "--- Turn 2 ---","Player 2's turn begins",
        "Player 2 quested with Woody (+5 [LORE], 0 -> 5)",
        "--- Turn 3 ---","Player 1's turn begins",
        "--- Turn 4 ---","Player 2's turn begins",
        "Player 2 quested with Woody (+5 [LORE], 5 -> 10)",
        "--- Turn 5 ---","Player 1's turn begins",
        "Player 1 quested with Dale - Ready for His Shot (+2 [LORE], 0 -> 2)",
        "--- Turn 6 ---","Player 2's turn begins",
        "Player 2 won with 20 [LORE]"
      );
      const g3 = parseLog(raw3, DECK, { deckStrategy:'' });
      assert("3. loss, late/low clock", g3.result==="L" && g3.lossCondition.primary==="Never built a lore clock", JSON.stringify({result:g3.result, loss:g3.lossCondition.primary, myLore:g3.myLore}));
    }catch(e){ assert("3. loss, late/low clock", false, String(e)); }

    // 4. High removal / low lore loss
    try{
      const raw4 = L(
        "Player 1's starting hand: Dale - Ready for His Shot",
        "Player 2's starting hand: Woody",
        "--- Turn 1 ---","Player 1's turn begins",
        "Player 1 activated SOMETHING and banishes Woody","Woody was banished",
        "--- Turn 2 ---","Player 2's turn begins",
        "--- Turn 3 ---","Player 1's turn begins",
        "Player 1 activated SOMETHING and banishes Jessie","Jessie was banished",
        "--- Turn 4 ---","Player 2's turn begins",
        "--- Turn 5 ---","Player 1's turn begins",
        "Player 1 activated SOMETHING and banishes Bullseye","Bullseye was banished",
        "Player 1 quested with Dale - Ready for His Shot (+8 [LORE], 0 -> 8)",
        "--- Turn 6 ---","Player 2's turn begins",
        "--- Turn 7 ---","Player 1's turn begins",
        "Player 1 activated SOMETHING and banishes Hamm","Hamm was banished",
        "--- Turn 8 ---","Player 2's turn begins",
        "Player 2 won with 20 [LORE]"
      );
      const g4 = parseLog(raw4, DECK, { deckStrategy:'' });
      assert("4. high removal / low lore loss", g4.result==="L" && g4.removedByMe>=4 && g4.lossCondition.primary==="Too much control, not enough questing", JSON.stringify({removedByMe:g4.removedByMe, loss:g4.lossCondition.primary, myLore:g4.myLore}));
    }catch(e){ assert("4. high removal / low lore loss", false, String(e)); }

    // 5. Strategy target missed (reuse raw3's shape — never crosses 10)
    try{
      const raw5 = L(
        "Player 1's starting hand: Dale - Ready for His Shot",
        "Player 2's starting hand: Woody",
        "--- Turn 1 ---","Player 1's turn begins",
        "--- Turn 2 ---","Player 2's turn begins",
        "Player 2 quested with Woody (+5 [LORE], 0 -> 5)",
        "--- Turn 3 ---","Player 1's turn begins",
        "--- Turn 4 ---","Player 2's turn begins",
        "Player 2 quested with Woody (+5 [LORE], 5 -> 10)",
        "--- Turn 5 ---","Player 1's turn begins",
        "Player 1 quested with Dale - Ready for His Shot (+2 [LORE], 0 -> 2)",
        "--- Turn 6 ---","Player 2's turn begins",
        "Player 2 won with 20 [LORE]"
      );
      const g5 = parseLog(raw5, DECK, { deckStrategy:'Cross 10 lore by turn 6.' });
      assert("5. strategy target missed", g5.planScore.label==="Off plan" || g5.planScore.score<50, JSON.stringify({planScore:g5.planScore}));
    }catch(e){ assert("5. strategy target missed", false, String(e)); }

    // 6. Strategy target achieved (reuse raw2's shape — crosses 10 turn 3)
    try{
      const raw6 = L(
        "Player 1's starting hand: Dale - Ready for His Shot",
        "Player 2's starting hand: Woody",
        "--- Turn 1 ---","Player 1's turn begins",
        "--- Turn 2 ---","Player 2's turn begins",
        "--- Turn 3 ---","Player 1's turn begins",
        "Player 1 quested with Dale - Ready for His Shot (+10 [LORE], 0 -> 10)",
        "--- Turn 4 ---","Player 2's turn begins",
        "--- Turn 5 ---","Player 1's turn begins",
        "Player 1 quested with Dale - Ready for His Shot (+10 [LORE], 10 -> 20)",
        "Player 1 won with 20 [LORE]"
      );
      const g6 = parseLog(raw6, DECK, { deckStrategy:'Cross 10 lore by turn 6.' });
      assert("6. strategy target achieved", g6.planScore.label==="On plan" || g6.planScore.score>=80, JSON.stringify({planScore:g6.planScore}));
    }catch(e){ assert("6. strategy target achieved", false, String(e)); }

    // 7. Old 2-arg call still works
    try{
      const raw7 = L(
        "Player 1's starting hand: Dale - Ready for His Shot",
        "Player 2's starting hand: Woody",
        "--- Turn 1 ---","Player 1's turn begins",
        "Player 1 played Dale - Ready for His Shot (cost 3)",
        "--- Turn 2 ---","Player 2's turn begins",
        "--- Turn 3 ---","Player 1's turn begins",
        "Player 1 quested with Dale - Ready for His Shot (+5 [LORE], 0 -> 5)",
        "--- Turn 4 ---","Player 2's turn begins",
        "Player 2 conceded","Player 1 won"
      );
      const g7 = parseLog(raw7, DECK); // no options arg at all
      assert("7. old 2-arg call still works", typeof g7.result==="string" && g7.parserVersion===2, JSON.stringify({result:g7.result, parserVersion:g7.parserVersion}));
    }catch(e){ assert("7. old 2-arg call still works", false, String(e)); }

    const pass = results.every(r=>r.pass);
    if(typeof console!=="undefined" && console.log){
      console.log("[LORCANA self-test]", pass?"ALL PASS":"FAILURES", results);
    }
    return { pass, results };
  }

  root.LORCANA = { parseLog, parseManyLogs, DECK, ARCHETYPES, WIN_CATS, LOSS_CATS, COMBO_DEFS,
    parseStrategyHints, classifyWinCondition, classifyLossCondition, computePlanScore, buildCoachReport,
    keyTurningPoints, rawHash, runParserSelfTest, buildReplay };
  if (typeof module!=="undefined" && module.exports) module.exports = root.LORCANA;
})(typeof globalThis!=="undefined"?globalThis:this);
;(function(root){ root.LORCANA_SEED = [
 {
  "id": "gmbwp6as",
  "dateAdded": "2026-06-27",
  "me": 1,
  "onPlay": true,
  "mulligan": 3,
  "myLore": 10,
  "oppLore": 1,
  "margin": 9,
  "cross10": 9,
  "cross20": null,
  "cross10MyTurn": 5,
  "firstQuest": 5,
  "firstQuestMyTurn": 3,
  "myTurns": 4,
  "gameTurns": 10,
  "lorePerTurn": 2.5,
  "result": "W",
  "method": "concession",
  "removedByMe": 1,
  "myLost": 4,
  "questers": {
   "Mulan - Injured Soldier": 4,
   "Scrooge McDuck - Ghostly Ebenezer": 3,
   "Stitch - Carefree Snowboarder": 2,
   "Reuben - Sandwich Expert": 1
  },
  "combos": {
   "dale": true,
   "mulanElite": false,
   "tripleShot": false,
   "sword": false,
   "ohana": false,
   "reuben": true,
   "snowboarder": true,
   "gastonLock": false,
   "pressure": false,
   "boost": false
  },
  "loreByTurn": {
   "5": 1,
   "7": 5,
   "9": 10
  },
  "oppLoreByTurn": {
   "8": 1
  },
  "archetype": "Princesses",
  "winCat": "Opponent conceded behind",
  "lossCat": "",
  "venue": "",
  "notes": ""
 },
 {
  "id": "gnyy1shr",
  "dateAdded": "2026-06-27",
  "me": 1,
  "onPlay": true,
  "mulligan": 4,
  "myLore": 19,
  "oppLore": 20,
  "margin": -1,
  "cross10": 23,
  "cross20": null,
  "cross10MyTurn": 12,
  "firstQuest": 9,
  "firstQuestMyTurn": 5,
  "myTurns": 17,
  "gameTurns": 34,
  "lorePerTurn": 1.12,
  "result": "L",
  "method": "20 lore",
  "removedByMe": 18,
  "myLost": 18,
  "questers": {
   "Scrooge McDuck - Ghostly Ebenezer": 3,
   "Gaston - Frightful Bully": 2,
   "Chip - Retrieval Expert": 4,
   "Dale - Ready for His Shot": 6,
   "Mulan - Injured Soldier": 1,
   "Reuben - Sandwich Expert": 1,
   "Stitch - Carefree Snowboarder": 2
  },
  "combos": {
   "dale": true,
   "mulanElite": true,
   "tripleShot": false,
   "sword": true,
   "ohana": true,
   "reuben": true,
   "snowboarder": true,
   "gastonLock": false,
   "pressure": false,
   "boost": true
  },
  "loreByTurn": {
   "9": 1,
   "11": 3,
   "15": 4,
   "17": 7,
   "23": 13,
   "25": 16,
   "27": 19
  },
  "oppLoreByTurn": {
   "10": 1,
   "12": 3,
   "14": 4,
   "16": 5,
   "18": 6,
   "20": 9,
   "28": 10,
   "30": 12,
   "32": 15,
   "34": 20
  },
  "archetype": "Sapphire/Steel Control",
  "winCat": "",
  "lossCat": "Out-removed by control",
  "venue": "",
  "notes": ""
 },
 {
  "id": "g0qjftzh",
  "dateAdded": "2026-06-27",
  "me": 2,
  "onPlay": true,
  "mulligan": 0,
  "myLore": 11,
  "oppLore": 6,
  "margin": 5,
  "cross10": 13,
  "cross20": null,
  "cross10MyTurn": 7,
  "firstQuest": 7,
  "firstQuestMyTurn": 4,
  "myTurns": 7,
  "gameTurns": 13,
  "lorePerTurn": 1.57,
  "result": "W",
  "method": "concession",
  "removedByMe": 3,
  "myLost": 1,
  "questers": {
   "Mulan - Elite Archer": 6,
   "Bambi - Ethereal Fawn": 3,
   "Gaston - Frightful Bully": 2
  },
  "combos": {
   "dale": true,
   "mulanElite": true,
   "tripleShot": false,
   "sword": false,
   "ohana": false,
   "reuben": true,
   "snowboarder": false,
   "gastonLock": false,
   "pressure": true,
   "boost": true
  },
  "loreByTurn": {
   "7": 2,
   "9": 5,
   "11": 9,
   "13": 11
  },
  "oppLoreByTurn": {
   "4": 1,
   "8": 2,
   "10": 3,
   "12": 6
  },
  "archetype": "Locations",
  "winCat": "Opponent conceded behind",
  "lossCat": "",
  "venue": "",
  "notes": ""
 },
 {
  "id": "gvvbjj5h",
  "dateAdded": "2026-06-27",
  "me": 1,
  "onPlay": false,
  "mulligan": 4,
  "myLore": 3,
  "oppLore": 20,
  "margin": -17,
  "cross10": null,
  "cross20": null,
  "cross10MyTurn": null,
  "firstQuest": 14,
  "firstQuestMyTurn": 7,
  "myTurns": 10,
  "gameTurns": 21,
  "lorePerTurn": 0.3,
  "result": "L",
  "method": "20 lore",
  "removedByMe": 3,
  "myLost": 6,
  "questers": {
   "Scrooge McDuck - Ghostly Ebenezer": 1,
   "Gaston - Frightful Bully": 1,
   "Bambi - Ethereal Fawn": 1
  },
  "combos": {
   "dale": false,
   "mulanElite": true,
   "tripleShot": false,
   "sword": false,
   "ohana": true,
   "reuben": false,
   "snowboarder": false,
   "gastonLock": false,
   "pressure": true,
   "boost": true
  },
  "loreByTurn": {
   "14": 1,
   "16": 3
  },
  "oppLoreByTurn": {
   "3": 1,
   "9": 2,
   "11": 3,
   "13": 4,
   "15": 6,
   "17": 8,
   "19": 14,
   "21": 20
  },
  "archetype": "Sapphire/Steel Control",
  "winCat": "",
  "lossCat": "Out-removed by control",
  "venue": "",
  "notes": ""
 },
 {
  "id": "guiomtro",
  "dateAdded": "2026-06-27",
  "me": 1,
  "onPlay": true,
  "mulligan": 3,
  "myLore": 3,
  "oppLore": 11,
  "margin": -8,
  "cross10": null,
  "cross20": null,
  "cross10MyTurn": null,
  "firstQuest": 5,
  "firstQuestMyTurn": 3,
  "myTurns": 10,
  "gameTurns": 20,
  "lorePerTurn": 0.3,
  "result": "L",
  "method": "concession",
  "removedByMe": 3,
  "myLost": 3,
  "questers": {
   "Mulan - Elite Archer": 2,
   "Reuben - Sandwich Expert": 1
  },
  "combos": {
   "dale": true,
   "mulanElite": true,
   "tripleShot": false,
   "sword": false,
   "ohana": true,
   "reuben": true,
   "snowboarder": false,
   "gastonLock": false,
   "pressure": true,
   "boost": true
  },
  "loreByTurn": {
   "5": 2,
   "7": 3
  },
  "oppLoreByTurn": {
   "8": 1,
   "10": 2,
   "12": 3,
   "20": 11
  },
  "archetype": "Sapphire/Steel Control",
  "winCat": "",
  "lossCat": "Out-removed by control",
  "venue": "",
  "notes": ""
 },
 {
  "id": "gq7n41se",
  "dateAdded": "2026-06-27",
  "me": 1,
  "onPlay": false,
  "mulligan": 3,
  "myLore": 0,
  "oppLore": 17,
  "margin": -17,
  "cross10": null,
  "cross20": null,
  "cross10MyTurn": null,
  "firstQuest": null,
  "firstQuestMyTurn": null,
  "myTurns": 6,
  "gameTurns": 12,
  "lorePerTurn": 0,
  "result": "L",
  "method": "concession",
  "removedByMe": 0,
  "myLost": 0,
  "questers": {},
  "combos": {
   "dale": false,
   "mulanElite": false,
   "tripleShot": false,
   "sword": false,
   "ohana": true,
   "reuben": false,
   "snowboarder": false,
   "gastonLock": false,
   "pressure": false,
   "boost": true
  },
  "loreByTurn": {},
  "oppLoreByTurn": {
   "3": 1,
   "5": 3,
   "7": 6,
   "9": 9,
   "11": 17
  },
  "archetype": "Toys",
  "winCat": "",
  "lossCat": "Never built a clock",
  "venue": "",
  "notes": ""
 },
 {
  "id": "gdo5hzu6",
  "dateAdded": "2026-06-27",
  "me": 1,
  "onPlay": false,
  "mulligan": 5,
  "myLore": 0,
  "oppLore": 20,
  "margin": -20,
  "cross10": null,
  "cross20": null,
  "cross10MyTurn": null,
  "firstQuest": null,
  "firstQuestMyTurn": null,
  "myTurns": 6,
  "gameTurns": 13,
  "lorePerTurn": 0,
  "result": "L",
  "method": "20 lore",
  "removedByMe": 4,
  "myLost": 0,
  "questers": {},
  "combos": {
   "dale": false,
   "mulanElite": true,
   "tripleShot": true,
   "sword": false,
   "ohana": false,
   "reuben": true,
   "snowboarder": false,
   "gastonLock": false,
   "pressure": true,
   "boost": true
  },
  "loreByTurn": {},
  "oppLoreByTurn": {
   "3": 1,
   "5": 4,
   "9": 9,
   "11": 16,
   "13": 20
  },
  "archetype": "Dwarves",
  "winCat": "",
  "lossCat": "Never built a clock",
  "venue": "",
  "notes": ""
 },
 {
  "id": "g32hrvfl",
  "dateAdded": "2026-06-27",
  "me": 1,
  "onPlay": true,
  "mulligan": 3,
  "myLore": 8,
  "oppLore": 12,
  "margin": -4,
  "cross10": null,
  "cross20": null,
  "cross10MyTurn": null,
  "firstQuest": 13,
  "firstQuestMyTurn": 7,
  "myTurns": 9,
  "gameTurns": 17,
  "lorePerTurn": 0.89,
  "result": "W",
  "method": "concession",
  "removedByMe": 9,
  "myLost": 2,
  "questers": {
   "Mulan - Elite Archer": 4,
   "Stitch - Carefree Surfer": 4
  },
  "combos": {
   "dale": true,
   "mulanElite": true,
   "tripleShot": true,
   "sword": false,
   "ohana": true,
   "reuben": true,
   "snowboarder": false,
   "gastonLock": false,
   "pressure": true,
   "boost": false
  },
  "loreByTurn": {
   "13": 4,
   "15": 8
  },
  "oppLoreByTurn": {
   "8": 3,
   "10": 5,
   "16": 12
  },
  "archetype": "Locations",
  "winCat": "Dale + Mulan board clear",
  "lossCat": "",
  "venue": "",
  "notes": ""
 },
 {
  "id": "g98wp9h1",
  "dateAdded": "2026-06-27",
  "me": 1,
  "onPlay": true,
  "mulligan": 4,
  "myLore": 19,
  "oppLore": 16,
  "margin": 3,
  "cross10": 11,
  "cross20": null,
  "cross10MyTurn": 6,
  "firstQuest": 5,
  "firstQuestMyTurn": 3,
  "myTurns": 10,
  "gameTurns": 19,
  "lorePerTurn": 1.9,
  "result": "L",
  "method": "concession",
  "removedByMe": 2,
  "myLost": 6,
  "questers": {
   "Mulan - Elite Archer": 10,
   "Dale - Ready for His Shot": 4,
   "Chip - Retrieval Expert": 1,
   "Reuben - Sandwich Expert": 2,
   "Scrooge McDuck - Ghostly Ebenezer": 2
  },
  "combos": {
   "dale": true,
   "mulanElite": true,
   "tripleShot": false,
   "sword": false,
   "ohana": true,
   "reuben": true,
   "snowboarder": false,
   "gastonLock": false,
   "pressure": false,
   "boost": true
  },
  "loreByTurn": {
   "5": 2,
   "7": 4,
   "9": 6,
   "11": 12,
   "13": 15,
   "15": 16,
   "17": 17,
   "19": 19
  },
  "oppLoreByTurn": {
   "10": 5,
   "12": 10,
   "16": 11,
   "18": 16
  },
  "archetype": "Other / Unknown",
  "winCat": "",
  "lossCat": "Out-removed by control",
  "venue": "",
  "notes": ""
 },
 {
  "id": "gnfyffa6",
  "dateAdded": "2026-06-27",
  "me": 1,
  "onPlay": false,
  "mulligan": 3,
  "myLore": 2,
  "oppLore": 20,
  "margin": -18,
  "cross10": null,
  "cross20": null,
  "cross10MyTurn": null,
  "firstQuest": 16,
  "firstQuestMyTurn": 8,
  "myTurns": 8,
  "gameTurns": 17,
  "lorePerTurn": 0.25,
  "result": "L",
  "method": "20 lore",
  "removedByMe": 4,
  "myLost": 3,
  "questers": {
   "Gaston - Frightful Bully": 1,
   "Mulan - Injured Soldier": 1
  },
  "combos": {
   "dale": true,
   "mulanElite": false,
   "tripleShot": false,
   "sword": false,
   "ohana": false,
   "reuben": true,
   "snowboarder": false,
   "gastonLock": false,
   "pressure": false,
   "boost": true
  },
  "loreByTurn": {
   "16": 2
  },
  "oppLoreByTurn": {
   "3": 1,
   "5": 3,
   "7": 4,
   "9": 6,
   "11": 7,
   "13": 9,
   "15": 13,
   "17": 20
  },
  "archetype": "Locations",
  "winCat": "",
  "lossCat": "Locations ticked me out",
  "venue": "",
  "notes": ""
 },
 {
  "id": "g2wqdvqh",
  "dateAdded": "2026-06-27",
  "me": 2,
  "onPlay": true,
  "mulligan": 4,
  "myLore": 10,
  "oppLore": 15,
  "margin": -5,
  "cross10": 19,
  "cross20": null,
  "cross10MyTurn": 10,
  "firstQuest": 5,
  "firstQuestMyTurn": 3,
  "myTurns": 11,
  "gameTurns": 23,
  "lorePerTurn": 0.91,
  "result": "L",
  "method": "concession",
  "removedByMe": 10,
  "myLost": 14,
  "questers": {
   "Scrooge McDuck - Ghostly Ebenezer": 1,
   "Gaston - Frightful Bully": 4,
   "Reuben - Sandwich Expert": 3,
   "Stitch - Carefree Snowboarder": 2
  },
  "combos": {
   "dale": true,
   "mulanElite": true,
   "tripleShot": true,
   "sword": false,
   "ohana": true,
   "reuben": true,
   "snowboarder": true,
   "gastonLock": false,
   "pressure": true,
   "boost": true
  },
  "loreByTurn": {
   "5": 1,
   "7": 2,
   "11": 3,
   "15": 5,
   "17": 7,
   "19": 10
  },
  "oppLoreByTurn": {
   "12": 3,
   "20": 11,
   "22": 15
  },
  "archetype": "Sapphire/Steel Control",
  "winCat": "",
  "lossCat": "Out-removed by control",
  "venue": "",
  "notes": ""
 }
]; })(typeof globalThis!=="undefined"?globalThis:this);
