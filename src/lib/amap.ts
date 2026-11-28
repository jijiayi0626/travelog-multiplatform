/**
 * 高德地图 URI Scheme 封装。
 * 使用 uri.amap.com 的 HTTPS 链接：网页直接打开高德网页版，
 * Android 包内也能通过系统浏览器 / 高德 App 唤起（未安装时回落网页）。
 */

function open(url: string): void {
  window.open(url, '_blank', 'noopener')
}

/** 在地图上标注一个地点 */
export function amapMarker(lat: number, lng: number, name: string): string {
  return `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(name)}&src=travelog&coordinate=gaode&callnative=1`
}

/** 以汽车模式导航到某个地点 */
export function amapNav(lat: number, lng: number, name: string): string {
  return `https://uri.amap.com/navigation?to=${lng},${lat},${encodeURIComponent(name)}&mode=car&src=travelog&coordinate=gaode&callnative=1`
}

/** 用关键词搜索地点（适合只有文字、没有经纬度的地点） */
export function amapSearch(keyword: string): string {
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(keyword)}&src=travelog&callnative=1`
}

export function openAmapMarker(lat: number, lng: number, name: string): void {
  open(amapMarker(lat, lng, name))
}

export function openAmapNav(lat: number, lng: number, name: string): void {
  open(amapNav(lat, lng, name))
}

export function openAmapSearch(keyword: string): void {
  if (!keyword.trim()) return
  open(amapSearch(keyword))
}
