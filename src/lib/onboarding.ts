const KEY = 'travelog.onboarded.v1'
const EVENT = 'travelog:onboarding-open'

export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // 忽略隐私模式下的写入失败
  }
}

/** 从「关于 / 我的」重新打开新手引导 */
export function openOnboarding(): void {
  window.dispatchEvent(new Event(EVENT))
}

export function subscribeOnboardingOpen(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
