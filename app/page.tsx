"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const MapComponent = dynamic(() => import("../components/Map/MapComponent"), {
  ssr: false,
});

type MobilityAid = "wheelchair" | "scooter" | "walker" | "cane" | "crutches" | "prosthetic";

const aids: { id: MobilityAid; name: string; emoji: string; description: string }[] = [
  { id: "wheelchair", name: "Fauteuil roulant", emoji: "🪑", description: "Mobilité manuelle ou électrique" },
  { id: "scooter", name: "Scooter électrique", emoji: "🛵", description: "Déplacement motorisé" },
  { id: "walker", name: "Déambulateur", emoji: "🚶‍♂️", description: "Support pour la marche" },
  { id: "cane", name: "Canne", emoji: "🦯", description: "Aide à la stabilité" },
  { id: "crutches", name: "Béquilles", emoji: "🩼", description: "Support sous les bras" },
  { id: "prosthetic", name: "Prothèse", emoji: "🦵", description: "Membre artificiel" },
];

export default function Home() {
  const [showWelcome, setShowWelcome] = useState(true);
  const [showSelection, setShowSelection] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [selectedAid, setSelectedAid] = useState<MobilityAid | null>(null);

  const handleStart = () => {
    setFadeOut(true);
    setTimeout(() => {
      setShowWelcome(false);
      setShowSelection(true);
      setFadeOut(false);
    }, 500);
  };

  const handleSelectAid = (aid: MobilityAid) => {
    setSelectedAid(aid);
    setFadeOut(true);
    setTimeout(() => {
      setShowSelection(false);
      setFadeOut(false);
    }, 500);
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

  if (showSelection) {
    return (
      <div className={`selection-container ${fadeOut ? 'fade-out' : ''}`}>
        <div className="selection-content">
          <h1 className="selection-title">Choisissez votre aide à la mobilité</h1>
          <p className="selection-subtitle">
            Cela nous aide à personnaliser votre expérience et à signaler les obstacles pertinents.
          </p>
          <div className="aids-grid">
            {aids.map((aid, index) => (
              <div
                key={aid.id}
                className="aid-card"
                style={{ animationDelay: `${index * 0.1}s` }}
                onClick={() => handleSelectAid(aid.id)}
              >
                <div className="aid-emoji">{aid.emoji}</div>
                <h3 className="aid-name">{aid.name}</h3>
                <p className="aid-description">{aid.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <MapComponent selectedAid={selectedAid} />;
}