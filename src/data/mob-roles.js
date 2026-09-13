// Roles add readable combat decisions to existing authored models and rewards.
export const MOB_ROLES = {
  charger: {name:'돌격',color:0xff9857,reach:8,windup:.9,travel:.4,recovery:.9,cooldown:.45,width:2.2,damage:1,kb:5,animation:'dash'},
  flanker: {name:'측면 침투',color:0xc89bff,reach:5,windup:.8,travel:.5,recovery:.75,cooldown:.3,radius:1.85,damage:1,kb:3,animation:'attack'},
  crusher: {name:'분쇄',color:0xffc66a,reach:3,windup:1.2,travel:0,recovery:1.05,cooldown:.55,radius:3.1,damage:1.15,kb:8,animation:'attackHeavy'},
};
export const MOB_ROLE_ENEMIES = {
  orc:'charger',alien:'charger',skel_rogue:'flanker',ninja:'flanker',bone_orc:'crusher',orc_blob:'crusher',
};
export const MAX_MOB_ROLE_ATTACKS = 3;
