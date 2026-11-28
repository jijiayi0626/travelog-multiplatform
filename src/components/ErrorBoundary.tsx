import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 渲染异常时给用户一个可操作的兜底页，避免整个应用白屏 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('页面渲染出错', error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  private goHome = () => {
    window.location.hash = '#/trips'
    this.reset()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-paper px-5">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-body-lg font-semibold text-ink">页面出了点问题</p>
          <p className="mt-2 break-words text-body-sm leading-6 text-ink-3">
            {this.state.error.message || '未知错误'}
          </p>
          <div className="mt-5 flex gap-2">
            <button type="button" className="btn-primary flex-1" onClick={this.reset}>
              重试
            </button>
            <button type="button" className="btn-ghost flex-1" onClick={this.goHome}>
              回到首页
            </button>
          </div>
          <p className="mt-4 text-caption leading-4 text-ink-3">
            数据保存在本机，不会因为页面出错丢失。
          </p>
        </div>
      </div>
    )
  }
}
