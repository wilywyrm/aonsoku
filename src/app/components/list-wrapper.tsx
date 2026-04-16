import { ComponentPropsWithRef, forwardRef } from 'react'
import { cn } from '@/lib/utils'

type ListWrapperProps = ComponentPropsWithRef<'div'>

const ListWrapper = forwardRef<HTMLDivElement, ListWrapperProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'w-full px-8 py-6 bg-transparent relative z-0',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    )
  },
)

ListWrapper.displayName = 'ListWrapper'

export default ListWrapper
