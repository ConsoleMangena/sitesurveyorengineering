import { useEffect, useState } from 'react';
import './SplashScreen.css';

interface SplashScreenProps {
  onFinish: () => void;
  duration?: number;
}

export default function SplashScreen({ onFinish, duration = 3000 }: SplashScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeOut(true);
      setTimeout(onFinish, 600);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onFinish]);

  return (
    <div className={`splash-screen ${fadeOut ? 'splash-fade-out' : ''}`}>
      <div className="splash-content">
        <img
          src="/logo.svg"
          alt="SiteSurveyor Logo"
          className="splash-logo app-logo"
        />
        <p className="splash-tagline">SiteSurveyor</p>
        <p className="splash-subtitle">Engineering Survey Management</p>
        <div className="splash-dots" aria-label="Loading">
          <span className="splash-dot splash-dot--1" />
          <span className="splash-dot splash-dot--2" />
          <span className="splash-dot splash-dot--3" />
        </div>
        <span className="splash-loading-text">Loading...</span>
      </div>
    </div>
  );
}
