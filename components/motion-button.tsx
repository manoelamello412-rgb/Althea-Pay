'use client'

import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const motionButtonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 rounded-xl select-none outline-none whitespace-nowrap font-medium transition-[border-color,background-color,color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-[#1DB854]/50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[#0F1A16] text-white border border-zinc-800/60 hover:border-[#1DB854]/40',
        ghost: 'bg-transparent text-zinc-300 hover:bg-[#0F1A16] hover:text-white',
        outline: 'bg-transparent text-white border border-zinc-800/60 hover:border-[#1DB854]/50 hover:text-[#1DB854]',
        action: 'bg-[#1DB854] text-black border border-[#1DB854]/70 hover:shadow-[0_0_28px_rgba(29,184,84,0.22)]',
      },
      size: {
        default: 'h-10 px-4 text-sm',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

type MotionButtonProps = HTMLMotionProps<'button'> & VariantProps<typeof motionButtonVariants> & { children: ReactNode; glow?: boolean }

export default function MotionButton({ children, className = '', glow = false, variant, size, ...props }: MotionButtonProps) {
  const reducedMotion = useReducedMotion()
  return (
    <motion.button
      type={props.type ?? 'button'}
      {...props}
      whileHover={reducedMotion ? undefined : { y: -2, scale: 1.015 }}
      whileTap={reducedMotion ? undefined : { scale: 0.95, y: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 22, mass: 0.7 }}
      className={cn(motionButtonVariants({ variant, size }), glow && 'after:pointer-events-none after:absolute after:inset-1 after:-z-10 after:rounded-xl after:bg-[#1DB854]/10 after:blur-xl', className)}
    >
      {children}
    </motion.button>
  )
}
