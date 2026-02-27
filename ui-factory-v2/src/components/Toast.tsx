type ToastProps = {
  message: string
  tone?: 'success' | 'error' | 'neutral'
}

function Toast({ message, tone = 'neutral' }: ToastProps) {
  if (!message) return null
  return <div className={`toast toast-${tone}`}>{message}</div>
}

export default Toast
