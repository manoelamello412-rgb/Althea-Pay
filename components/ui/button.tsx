'use client'

import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium outline-none select-none transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:ring-2 focus-visible:ring-[#1DB854]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A09] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]',
  {
    variants: {
      variant: {
        default: 'border border-[#1DB854]/30 bg-[#0F1A16] text-white shadow-[0_10px_30px_rgba(0,0,0,.22)] hover:border-[#1DB854]/55 hover:bg-[#0D362D]/70',
        ghost: 'border border-transparent bg-transparent text-[#A6A6A6] hover:bg-[#0F1A16] hover:text-white',
        outline: 'border border-zinc-800/70 bg-[#0F1A16]/70 text-white hover:border-[#1DB854]/40 hover:bg-[#12351F]/60',
        destructive: 'border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:border-rose-400/50 hover:bg-rose-500/15',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 px-3 text-xs',
        icon: 'h-10 w-10 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  children?: ReactNode
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { buttonVariants }
