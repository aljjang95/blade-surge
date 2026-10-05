const appliedStyles = new WeakMap();

/** 같은 요청과 실제 인라인 선언이 모두 유지될 때만 중복 쓰기를 생략한다. */
export function writeHudStyle(style, property, value) {
  const incoming = String(value), serialized = style.getPropertyValue(property), priority = style.getPropertyPriority(property);
  let properties = appliedStyles.get(style);
  let previous = properties?.get(property);
  if (previous && previous.incoming === incoming && previous.serialized === serialized && previous.priority === priority) return false;
  style.setProperty(property, incoming);
  if (!properties) { properties = new Map(); appliedStyles.set(style, properties); }
  if (!previous) { previous = {}; properties.set(property, previous); }
  // 브라우저의 색·소수 정규화 결과를 보관하며 외부 초기화는 다음 비교에서 복구한다.
  previous.incoming = incoming; previous.serialized = style.getPropertyValue(property); previous.priority = style.getPropertyPriority(property);
  return true;
}
