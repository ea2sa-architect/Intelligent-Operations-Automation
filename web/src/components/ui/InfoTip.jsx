import { useState } from 'react'
import { Info } from 'lucide-react'

const POSITION = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left:   'right-full top-1/2 -translate-y-1/2 mr-2',
  right:  'left-full top-1/2 -translate-y-1/2 ml-2',
}

const ARROW = {
  top:    'top-full left-1/2 -translate-x-1/2 -mt-1',
  bottom: 'bottom-full left-1/2 -translate-x-1/2 mb-[-4px]',
  left:   'left-full top-1/2 -translate-y-1/2 -ml-1',
  right:  'right-full top-1/2 -translate-y-1/2 mr-[-4px]',
}

export function InfoTip({ content, side = 'top', size = 13, className = '' }) {
  const [visible, setVisible] = useState(false)

  return (
    <span className={`relative inline-flex items-center ml-1 ${className}`}>
      <span
        role="button"
        tabIndex={0}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setVisible(v => !v) }}
        className="text-gray-400 hover:text-indigo-500 transition-colors focus:outline-none cursor-default"
        aria-label="More information"
      >
        <Info size={size} />
      </span>

      {visible && (
        <span className={`absolute z-50 w-72 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl leading-relaxed pointer-events-none ${POSITION[side]}`}>
          {content}
          <span className={`absolute ${ARROW[side]} w-2 h-2 bg-gray-900 rotate-45`} />
        </span>
      )}
    </span>
  )
}
