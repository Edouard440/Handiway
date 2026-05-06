"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const MapComponent = dynamic(() => import("../components/Map/MapComponent"), {
  loading: () => <main className="loading-screen">Chargement de la carte...</main>,
  ssr: false,
});

export type MobilityAid =
  | "wheelchair"
  | "scooter"
  | "walker"
  | "cane"
  | "crutches"
  | "prosthetic";

type Aid = {
  id: MobilityAid;
  name: string;
  description: string;
};

const aids: Aid[] = [
  {
    id: "wheelchair",
    name: "Fauteuil roulant",
    description: "Trajets pensés pour éviter les marches et les passages trop étroits.",
  },
  {
    id: "scooter",
    name: "Scooter électrique",
    description: "Itinéraires adaptés aux déplacements motorisés et aux trottoirs praticables.",
  },
  {
    id: "walker",
    name: "Déambulateur",
    description: "Priorité aux chemins stables, lisibles et faciles à franchir.",
  },
  {
    id: "cane",
    name: "Canne",
    description: "Repérage des obstacles qui gênent l'équilibre ou la progression.",
  },
  {
    id: "crutches",
    name: "Béquilles",
    description: "Signalements utiles pour éviter les pentes raides et surfaces glissantes.",
  },
  {
    id: "prosthetic",
    name: "Prothèse",
    description: "Parcours avec moins de ruptures de niveau et de détours imprévus.",
  },
];

export default function Home() {
  const [screen, setScreen] = useState<"welcome" | "selection" | "map">("welcome");
  const [fadeOut, setFadeOut] = useState(false);
  const [selectedAid, setSelectedAid] = useState<MobilityAid | null>(null);

  const transitionTo = (nextScreen: "selection" | "map") => {
    setFadeOut(true);
    window.setTimeout(() => {
      setScreen(nextScreen);
      setFadeOut(false);
    }, 320);
  };

  const handleSelectAid = (aid: MobilityAid) => {
    setSelectedAid(aid);
    transitionTo("map");
  };

  const handleBackToSelection = () => {
    setFadeOut(true);
    window.setTimeout(() => {
      setScreen("selection");
      setFadeOut(false);
    }, 320);
  };

  if (screen === "welcome") {
    return (
      <main className={`welcome-container ${fadeOut ? "fade-out" : ""}`}>
        <section className="welcome-content" aria-labelledby="welcome-title">
          <p className="eyebrow">Accessibilité urbaine collaborative</p>
          <h1 className="welcome-title" id="welcome-title">
            HandiWay
          </h1>
          <p className="welcome-subtitle">Trouvez un passage praticable. Signalez ce qui bloque.</p>
          <p className="welcome-description">
            HandiWay aide les personnes à mobilité réduite à préparer leurs déplacements, repérer les
            obstacles et enrichir une carte utile pour toute la communauté.
          </p>
          <button className="welcome-button" onClick={() => transitionTo("selection")} type="button">
            Explorer la carte
          </button>
        </section>
      </main>
    );
  }

  if (screen === "selection") {
    return (
      <main className={`selection-container ${fadeOut ? "fade-out" : ""}`}>
        <section className="selection-content" aria-labelledby="selection-title">
          <p className="eyebrow">Profil de déplacement</p>
          <h1 className="selection-title" id="selection-title">
            Choisissez votre aide à la mobilité
          </h1>
          <p className="selection-subtitle">
            Le choix ajuste les indications et rend les signalements plus pertinents.
          </p>
          <div className="aids-grid">
            {aids.map((aid, index) => (
              <button
                className="aid-card"
                key={aid.id}
                onClick={() => handleSelectAid(aid.id)}
                style={{ animationDelay: `${index * 0.06}s` }}
                type="button"
              >
                <span className="aid-name">{aid.name}</span>
                <span className="aid-description">{aid.description}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return <MapComponent selectedAid={selectedAid} onBackToSelection={handleBackToSelection} />;
}
