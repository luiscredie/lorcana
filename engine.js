/* Lorcana engine — log parser + seed data.
   Classic script. Defines globalThis.LORCANA and globalThis.LORCANA_SEED.
   Parser ported verbatim from the original dashboard. */
(function (root) {
  const DECK = ["Dale - Ready for His Shot","Mulan - Elite Archer","Mulan - Injured Soldier",
  "This Growing Pressure","Ohana Means Family","Reuben - Sandwich Expert","Bambi - Ethereal Fawn",
  "Scrooge McDuck - Ghostly Ebenezer","Zeus - Defiant God","Gaston - Frightful Bully","Webby's Diary",
  "The Horseman Strikes!","Stitch - Carefree Snowboarder","Stitch - Carefree Surfer","Medallion Weights",
  "The Sword of Shan-Yu","Chip - Retrieval Expert"];

  const ARCHETYPES = ["Toys","Dwarves","Sapphire/Steel Control","Detective","Locations","Princesses","Amethyst/Sapphire Evasive","Amber/Emerald Aggro","Amber/Amethyst Evasive","Emerald/Sapphire Control","Amber/Ruby Toys","Other / Unknown"];
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

  function firstName(c){ return c.split(" - ")[0].trim(); }

  function parseLog(raw, deckList){
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

    return {
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
      archetype: arch, winCat, lossCat, venue:"", notes:""
    };
  }

  root.LORCANA = { parseLog, DECK, ARCHETYPES, WIN_CATS, LOSS_CATS, COMBO_DEFS };
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
