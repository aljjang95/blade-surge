// 계정 초기화 진행 중 표시. 켜져 있는 동안 세이브 저장과 계정 동기화 큐가 아무것도 쓰지 않는다(새로고침 전까지 유지).
let resetting = false;
export const isAccountResetting = () => resetting;
export const setAccountResetting = (on) => { resetting = !!on; };
