import React from 'react';
import mark from '../assets/waynur-mark.png';

// The Waynur logo mark (icon only, no wordmark) — used wherever the app
// shows its own brand: sidebars, top bars and the login screen.
export default function WaynurMark({ className = 'h-8 w-8' }) {
  return <img src={mark} alt="Waynur" className={`${className} object-contain shrink-0`} />;
}
