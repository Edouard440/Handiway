"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const MapComponent = dynamic(() => import("../components/Map/MapComponent"), {
  ssr: false,
});

export default function Home() {
  const [showWelcome, setShowWelcome] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  const handleStart = () => {
    setFadeOut(true);
    setTimeout(() => setShowWelcome(false), 500);
  };

  if (showWelcome) {
    return (
      <div className={`welcome-container ${fadeOut ? 'fade-out' : ''}`}>
        <div className="welcome-content">
          <h1 className="welcome-title">HandiWay</h1>
          <h2 className="welcome-subtitle">Signalement d'obstacles pour tous</h2>
          <p className="welcome-description">
            Découvrez et signalez les obstacles urbains pour améliorer l'accessibilité.
            Ensemble, rendons la ville plus inclusive pour tous les citoyens.
          </p>
          <button className="welcome-button" onClick={handleStart}>
            Commencer l'exploration
          </button>
        </div>
      </div>
    );
  }

  return <MapComponent />;
}