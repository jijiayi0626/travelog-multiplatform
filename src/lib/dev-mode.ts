const KEY = 'travelog.developer-mode'
const EVENT = 'travelog:developer-mode'

/** 开发者模式开关：默认关闭，开启后「我的」里才显示管理面板与恢复默认 */
export function isDevMode(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setDevMode(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // 隐私模式下可能写入失败，本次会话内仍按内存状态提示
  }
  window.dispatchEvent(new Event(EVENT))
}

export function subscribeDevMode(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
