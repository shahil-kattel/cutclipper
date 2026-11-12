export function BackgroundFX() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* Soft risograph ink blooms */}
      <div className="absolute -left-32 top-[4%] h-[24rem] w-[24rem] rounded-full bg-mustard/25 blur-[2px]" />
      <div className="absolute -right-40 top-[14%] h-[30rem] w-[30rem] rounded-full bg-periwinkle/15 blur-[3px]" />
      <div className="absolute -bottom-48 left-[18%] h-[30rem] w-[30rem] rounded-full bg-teal/10 blur-[2px]" />
      <div className="absolute -right-24 bottom-[6%] h-[18rem] w-[18rem] rounded-full bg-blush/20 blur-[2px]" />

      {/* Halftone corners */}
      <div className="paper-dots absolute -left-6 top-24 h-48 w-40 rotate-[-8deg] opacity-40 [mask-image:radial-gradient(circle_at_top_left,black,transparent_72%)]" />
      <div className="paper-dots absolute -right-4 bottom-40 h-56 w-44 rotate-[7deg] opacity-30 [mask-image:radial-gradient(circle_at_bottom_right,black,transparent_72%)]" />

      {/* Hand-drawn paper ephemera */}
      <svg
        viewBox="0 0 80 80"
        className="absolute left-[4%] top-[30%] hidden h-14 w-14 rotate-[-12deg] text-tomato opacity-60 lg:block"
      >
        <path
          d="M40 8v64M8 40h64M17 17l46 46M63 17L17 63"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="40" cy="40" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
      </svg>

      <svg
        viewBox="0 0 180 60"
        className="absolute right-[5%] top-[47%] hidden h-16 w-44 rotate-[3deg] text-ink opacity-25 xl:block"
      >
        <path
          d="M4 34c18-32 31 23 49-3s29 19 47-4 31 18 48-6 24 9 27 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M159 15l15 11-18 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <svg
        viewBox="0 0 64 64"
        className="absolute bottom-[18%] left-[8%] hidden h-12 w-12 rotate-[14deg] text-periwinkle opacity-55 lg:block"
      >
        <path
          d="M32 4l6 19 18-7-12 16 16 12-20-1-2 19-8-18-17 9 9-18L4 25l20 2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
      </svg>

      <div className="absolute right-[11%] top-[76%] hidden rotate-[6deg] border border-ink/20 bg-mustard-soft/60 px-3 py-1.5 font-hand text-lg text-ink/50 xl:block">
        snip, snip, share
      </div>

      {/* Cut line */}
      <div className="absolute left-0 right-0 top-[9.5rem] border-t border-dashed border-ink/10" />
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-[linear-gradient(180deg,transparent,rgba(33,29,25,0.035))]" />

      <div className="paper-noise absolute inset-0 opacity-[0.055]" />
    </div>
  )
}
