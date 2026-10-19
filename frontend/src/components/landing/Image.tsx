import type { ImgHTMLAttributes } from 'react'

interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  src: string
  alt: string
  width?: number
  height?: number
  priority?: boolean
  unoptimized?: boolean
}

export default function Image({
  src,
  alt,
  width,
  height,
  priority = false,
  unoptimized: _unoptimized,
  ...rest
}: ImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...rest}
    />
  )
}
