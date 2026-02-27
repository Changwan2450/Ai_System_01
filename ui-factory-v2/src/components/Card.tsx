import type { ReactNode } from 'react'

type CardProps = {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

function Card({ title, actions, children, className = '' }: CardProps) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <header className="card-header">
          {title ? <h2 className="card-title">{title}</h2> : <span />}
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

export default Card
