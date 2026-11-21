// SaymonGym's SG monogram: the crossbar doubles as a subtle barbell.

/** The mark alone, `height` px high (width follows, 352:174). `color` only for a one-colour use. */
export function BrandMark({ height = 24, color = '#42E8C1', className, style }) {
  return (
      <svg className={className} viewBox="0 0 100 100" width={height} height={height}
      fill={color} aria-hidden="true" focusable="false" style={{ flex: 'none', ...style }}>
      <path d="M19 29h62v10H19zM13 24h6v20h-6zM81 24h6v20h-6z" />
      <path d="M66 48H38c-13 0-22 8-22 19s9 18 22 18h27V75H39c-6 0-10-3-10-8s4-8 10-8h27z" />
      <path d="M38 52h28c13 0 22 8 22 19s-9 18-22 18H39V77h27c6 0 10-3 10-8s-4-8-10-8H38z" />
    </svg>
  )
}

/**
 * The SaymonGym lockup.
 */
export default function BrandLogo({ size = 34, as: Tag = 'span', className = '', style }) {
  return (
    <Tag className={('brand-lockup ' + className).trim()} dir="ltr" style={{ fontSize: size, ...style }}>
      <svg className="brand-lockup-mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <path d="M19 29h62v10H19zM13 24h6v20h-6zM81 24h6v20h-6z" />
        <path d="M66 48H38c-13 0-22 8-22 19s9 18 22 18h27V75H39c-6 0-10-3-10-8s4-8 10-8h27z" />
        <path d="M38 52h28c13 0 22 8 22 19s-9 18-22 18H39V77h27c6 0 10-3 10-8s-4-8-10-8H38z" />
      </svg>
      <span className="brand-lockup-open">Saymon</span><span className="brand-lockup-gym">Gym</span>
    </Tag>
  )
}
