'use client'

import { motion, type HTMLMotionProps } from 'framer-motion'
import type { ReactNode } from 'react'

type MotionButtonProps = HTMLMotionProps<'button'> & {
  children: ReactNode
}

export default function MotionButton({ children, className = '', ...props }: MotionButtonProps) {
  return (
    <motion.button
      {...props}
      whileHover={{ y: -2, scale: 1.015 }}
      whileTap={{ scale: 0.965, y: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 22, mass: 0.7 }}
      className={className}
    >
      {children}
    </motion.button>
  )
}
