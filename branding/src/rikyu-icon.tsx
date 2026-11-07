import type { CSSProperties } from 'react'

interface IconProps {
  src: string
  size?: number | string
  label?: string
  className?: string
  style?: CSSProperties
}

export function Icon({ src, size = '1em', label, className, style }: IconProps) {
  const mono = src.includes('tone=mono')
  const image = 'url("' + src + '")'
  return (
    <span
      data-rk-icon=""
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        verticalAlign: '-0.125em',
        backgroundColor: mono ? 'currentColor' : 'transparent',
        backgroundImage: mono ? 'none' : image,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'contain',
        maskImage: mono ? image : 'none',
        WebkitMaskImage: mono ? image : 'none',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        ...style,
      }}
    />
  )
}
