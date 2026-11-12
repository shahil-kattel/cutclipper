import rawCatalog from './captionFonts.json'
import { assetUrl } from './api'
import type { CaptionFontStyle } from '../types/api'

export interface CaptionFontOption {
  name: string
  category: string
  scripts: string[]
  fallback: string
  files: Partial<Record<CaptionFontStyle, string>>
}

export const CAPTION_FONT_OPTIONS = rawCatalog as CaptionFontOption[]

export const CAPTION_FONT_CATEGORIES = [
  'Sans Serif',
  'Serif',
  'Display',
  'Handwritten',
  'Monospace',
  'Rounded',
  'Devanagari',
  'System',
] as const

export const CAPTION_FONT_STYLE_OPTIONS: Array<{
  value: CaptionFontStyle
  label: string
  weight: number
  style: 'normal' | 'italic'
}> = [
  { value: 'regular', label: 'Regular', weight: 400, style: 'normal' },
  { value: 'bold', label: 'Bold', weight: 700, style: 'normal' },
  { value: 'italic', label: 'Italic', weight: 400, style: 'italic' },
  { value: 'bold_italic', label: 'Bold italic', weight: 700, style: 'italic' },
]

const FONT_BY_NAME = new Map(CAPTION_FONT_OPTIONS.map((font) => [font.name, font]))

export function captionFontOption(name: string): CaptionFontOption {
  return FONT_BY_NAME.get(name) ?? CAPTION_FONT_OPTIONS[0] ?? {
    name: 'Inter',
    category: 'Sans Serif',
    scripts: ['latin'],
    fallback: 'sans-serif',
    files: {},
  }
}

export function captionFontStack(name: string): string {
  const font = captionFontOption(name)
  return `'${font.name}', ${font.fallback}`
}

export function captionFontWeight(style: CaptionFontStyle): number {
  return style === 'bold' || style === 'bold_italic' ? 700 : 400
}

export function captionFontStyle(style: CaptionFontStyle): 'normal' | 'italic' {
  return style === 'italic' || style === 'bold_italic' ? 'italic' : 'normal'
}

export function supportsDevanagari(name: string): boolean {
  return captionFontOption(name).scripts.includes('devanagari')
}

let facesInstalled = false

export function installCaptionFontFaces(): void {
  if (facesInstalled || typeof document === 'undefined') return
  facesInstalled = true
  const rules: string[] = []
  for (const font of CAPTION_FONT_OPTIONS) {
    for (const option of CAPTION_FONT_STYLE_OPTIONS) {
      const filename = font.files[option.value]
      if (!filename) continue
      const url = assetUrl(`/api/caption-fonts/${encodeURIComponent(filename)}`)
      rules.push(
        `@font-face{font-family:'${font.name.replaceAll("'", "\\'")}';` +
          `src:url('${url}') format('truetype');` +
          `font-weight:${option.weight};font-style:${option.style};font-display:swap;}`,
      )
    }
  }
  if (!rules.length) return
  const style = document.createElement('style')
  style.id = 'cutclipper-caption-font-faces'
  style.textContent = rules.join('\n')
  document.head.append(style)
}

export function fontMatchesSearch(font: CaptionFontOption, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    font.name.toLowerCase().includes(needle) ||
    font.category.toLowerCase().includes(needle) ||
    font.scripts.some((script) => script.includes(needle))
  )
}
