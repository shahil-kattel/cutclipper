import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/space-grotesk/latin-400.css'
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/space-grotesk/latin-600.css'
import '@fontsource/space-grotesk/latin-700.css'
import '@fontsource/poppins/latin-400.css'
import '@fontsource/poppins/latin-500.css'
import '@fontsource/poppins/latin-600.css'
import '@fontsource/poppins/latin-700.css'
import '@fontsource-variable/fraunces/wght.css'
import '@fontsource-variable/fraunces/wght-italic.css'
import '@fontsource/caveat/latin-500.css'
import '@fontsource/caveat/latin-700.css'
import '@fontsource/bebas-neue/latin-400.css'
import '@fontsource/mukta/latin-400.css'
import '@fontsource/mukta/latin-700.css'
import '@fontsource/mukta/devanagari-400.css'
import '@fontsource/mukta/devanagari-700.css'
import '@fontsource/noto-sans-devanagari/devanagari-400.css'
import '@fontsource/hind/devanagari-400.css'
import '@fontsource/hind/devanagari-700.css'
import '@fontsource/kalam/devanagari-400.css'
import '@fontsource/kalam/devanagari-700.css'
import './index.css'
import App from './App'
import { installCaptionFontFaces } from './lib/captionFonts'

installCaptionFontFaces()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
