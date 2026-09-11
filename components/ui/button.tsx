'use client'

import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium outline-none select-none transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:ring-2 focus-visible:ring-[var(--althea-green)]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--althea-ink)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]',
  {
    variants: {
      variant: {
        default: 'border border-[var(--althea-green)]/30 bg-[var(--althea-forest)] text-[var(--althea-white)] shadow-[0_10px_30px_rgba(0,0,0,.22)] hover:border-[var(--althea-green)]/55 hover:bg-[var(--althea-deep)]/70',
        ghost: 'border border-transparent bg-transparent text-[var(--althea-silver)] hover:bg-[var(--althea-forest)] hover:text-[var(--althea-white)]',
        outline: 'border border-zinc-800/70 bg-[var(--althea-forest)]/70 text-[var(--althea-white)] hover:border-[var(--althea-green)]/40 hover:bg-[var(--althea-deep)]/60',
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
