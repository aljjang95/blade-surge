// 보스 예고 바닥 셰이더 — 고유기(game/boss-signatures.js)·일반 보스 패턴(engine/fx.js bossWarn)·파티 손님 화면 공용.
/** 보스 고유기 예고 전용 바닥 셰이더(일반 블렌딩). 판정 도형·크기·경고 시간은 그대로이고 그리는 법만 다르다.
 *  - 경계는 미터 단위 두께(.4m, 바깥 .11m 는 밝은 주황 테)로 어떤 크기에서도 같은 굵기, 정체성 색과 위험 적색을 70% 섞는다.
 *  - 경계 바로 안쪽에 어두운 띠(.4~.78m)를 깔아 밝은 청록·보라 바닥에서도 테두리가 떠 보이게 한다.
 *  - 남은 시간 채움은 진행할수록 적색 쪽으로 짙어지고(35%→80%), 진행 앞에는 밝은 주황 선이 선다.
 *  - 도형: 0 원판, 1 고리(안쪽 78%), 2 직사각 통로, 3 부채꼴(arc 반각). 일반 보스 패턴(engine/fx.js bossWarn)도 같은 셰이더를 쓴다.
 *  - 마지막 22% 는 경계가 주황↔적색으로 세 번 맥동하고 채움이 진해진다(progress 기반이라 결정적이다). */
export const bossSignatureFragmentShader = `
  varying vec2 vUv;
  uniform vec3 color;
  uniform vec2 size;
  uniform float shape, safeRadius, opacity, fired, progress, arc;
  void main(){
    vec2 p=(vUv-.5)*size; float r=length(p), d, along;
    if(r<safeRadius)discard;
    if(shape<1.5){
      float R=size.x*.5; if(r>R)discard;
      if(shape>.5){float r0=R*.78; if(r<r0)discard; d=min(R-r,r-r0); along=(r-r0)/max(R-r0,.001);}
      else{d=R-r; along=r/R;}
    } else if(shape<2.5){
      vec2 h=size*.5-abs(p); d=min(h.x,h.y); along=vUv.x;
    } else {
      // 부채꼴(shape 3): 국소 +x 가 정면, arc 는 반각(라디안). 남은 시간 채움은 보스에게서 바깥으로 차오른다.
      float R=size.x*.5; if(r>R)discard;
      float ang=abs(atan(p.y,p.x)); if(ang>arc)discard;
      d=min(R-r,(arc-ang)*r); along=r/R;
    }
    if(safeRadius>0.)d=min(d,r-safeRadius);
    float edge=1.-step(.4,d), band=step(.4,d)*(1.-step(.78,d)), lip=1.-step(.11,d);
    float stripe=step(.72,fract((p.x+p.y)*.6));
    float fill=(1.-step(progress,along))*(1.-fired);
    float front=exp(-pow((along-progress)/.035,2.))*step(.01,progress)*(1.-fired);
    float urgent=smoothstep(.78,1.,progress)*(1.-fired);
    float pulse=urgent*(.5+.5*sin(progress*85.));
    vec3 danger=vec3(1.,.2,.12);
    vec3 rim=mix(mix(color,danger,.7),vec3(1.,.62,.28),pulse*.7);
    vec3 body=mix(color,danger,.35+.45*progress);
    // 붉은 정체성 색(가마 0xff713d·도르래 0xff3355)은 붉은 바닥 위라 적색 채움이 묻힌다: 채움을 짙은 진홍으로 어둡게, 경계는 노란 열기로.
    float warm=step(.85,color.r)*(1.-step(.5,color.g));
    body=mix(body,mix(vec3(.32,.04,.03),vec3(.16,.02,.02),progress),warm);
    rim=mix(rim,mix(vec3(1.,.82,.22),vec3(1.,.62,.1),pulse),warm);
    vec3 c=body;
    c=mix(c,vec3(.06,.02,.02),band);
    c=mix(c,vec3(1.,.72,.42),clamp(front*.75,0.,1.));
    c=mix(c,rim,edge);
    // 가장 바깥 .11m 는 밝은 주황 테: 붉은 바닥(가마)에서도 경계가 떠 보인다.
    c=mix(c,mix(vec3(1.,.74,.42),vec3(.2,.02,.02),warm),lip*(1.-fired));
    float a=.14+stripe*.08*(1.-fill)+fill*(.3+urgent*.16+warm*.18)+band*.55+front*.55+edge*(.85+pulse*.15)+fired*.3;
    gl_FragColor=vec4(c,clamp(opacity*a,0.,1.));
  }`;
export const bossWarnVertexShader = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
