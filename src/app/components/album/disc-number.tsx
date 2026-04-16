import { Disc2Icon } from 'lucide-react'
import { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

type DiscNumberProps = ComponentPropsWithoutRef<'div'>

export function AlbumDiscNumber({
  className,
  children,
  ...props
}: DiscNumberProps) {
  return (
    <div
      className={cn(
        'w-full h-14 flex flex-row items-center transition-colors text-muted-foreground',
        className,
      )}
      role="row"
      {...props}
    >
      <div className="w-12 flex items-center justify-center">
        <Disc2Icon strokeWidth={1.75} />
      </div>
      <span className="font-medium ml-[7px]">{children}</span>
    </div>
  )
}
