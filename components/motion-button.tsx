'use client'

import { motion, type HTMLMotionProps } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type MotionButtonProps = HTMLMotionProps<'button'> & {
  children: ReactNode
  glow?: boolean
}

export default function MotionButton({ children, className = '', glow = false, ...props }: MotionButtonProps) {
  return (
    <motion.button
      {...props}
      whileHover={{ y: -2, scale: 1.015 }}
      whileTap={{ scale: 0.95, y: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 22, mass: 0.7 }}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-xl select-none outline-none',
        'transition-[border-color,background-color,color,box-shadow] duration-200',
        'focus-visible:ring-2 focus-visible:ring-[#1DB854]/50 disabled:pointer-events-none disabled:opacity-50',
        glow && 'after:pointer-events-none after:absolute after:inset-1 after:-z-10 after:rounded-xl after:bg-[#1DB854]/10 after:blur-xl',
        className,
      )}
    >
      {children}
    </motion.button>
  )
}
