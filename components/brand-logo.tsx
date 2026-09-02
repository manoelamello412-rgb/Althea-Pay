'use client'

import type { CSSProperties } from 'react'

type BrandLogoVariant = 'main' | 'mark' | 'wordmark'

type BrandLogoProps = {
  variant?: BrandLogoVariant
  className?: string
  alt?: string
  priority?: boolean
  style?: CSSProperties
}

const BRAND_ASSETS: Record<BrandLogoVariant, string> = {
  main: '/althea-logo.png.PNG',
  mark: '/althea-mark.png',
  wordmark: '/althea-wordmark.png',
}

export default function BrandLogo({ variant = 'main', className, alt = 'Althea Pay', priority = false, style }: BrandLogoProps) {
  return <img src={BRAND_ASSETS[variant]} alt={alt} className={className} style={style} loading={priority ? 'eager' : 'lazy'} />
}
