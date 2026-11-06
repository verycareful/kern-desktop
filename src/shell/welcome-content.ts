// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The fun facts the welcome pane of the editor layout shows beside the keyboard tips (which come
// from the action table, WelcomePane.tsx). They are about the world, not about Kern, and are kept
// to ones that are well established; each names the published reference it rests on. They ship
// with the application, which never fetches anything.

import { ANDROID_URL, PROFILE_URL, PROJECTS_URL, SOURCE_URL } from "../settings/links";

/** A word from the author, with the page its button opens. */
export interface WelcomeAsk {
  text: string;
  /** The button's label. */
  label: string;
  url: string;
}

export const WELCOME_ASKS: readonly WelcomeAsk[] = [
  { text: "Like Kern? A star on GitHub helps it.", label: "Star Kern on GitHub", url: SOURCE_URL },
  { text: "Kern is made by one person.", label: "Follow the author on GitHub", url: PROFILE_URL },
  { text: "Kern runs on Android phones too.", label: "See Kern for Android", url: ANDROID_URL },
  {
    text: "The author of Kern makes other things too.",
    label: "See the other projects",
    url: PROJECTS_URL,
  },
];

export interface WelcomeFact {
  /** The sentence shown. */
  text: string;
  /** The published reference the fact rests on. */
  source: string;
}

export const WELCOME_FACTS: readonly WelcomeFact[] = [
  {
    text: "Sunlight takes about eight minutes and twenty seconds to reach Earth.",
    source:
      "IAU 2012 Resolution B2 (the astronomical unit); BIPM, SI Brochure (the speed of light)",
  },
  {
    text: "Venus turns so slowly that its day is longer than its year, and it turns the opposite way to most planets.",
    source: "NASA Goddard Space Flight Center, Venus Fact Sheet",
  },
  {
    text: "An octopus has three hearts and blue blood.",
    source: "Encyclopaedia Britannica, 'Octopus'",
  },
  {
    text: "Botanically, bananas are berries and strawberries are not.",
    source: "Encyclopaedia Britannica, 'Berry'",
  },
  {
    text: "Water expands by about nine percent when it freezes, which is why ice floats.",
    source: "U.S. Geological Survey, Water Science School",
  },
  {
    text: "Sharks were swimming in the oceans before the first trees grew on land.",
    source: "Encyclopaedia Britannica, 'Chondrichthyan' and 'Devonian Period'",
  },
  {
    text: "Teaching was going on at Oxford before the Aztec capital Tenochtitlan was founded.",
    source:
      "University of Oxford, 'Introduction and history'; Encyclopaedia Britannica, 'Tenochtitlan'",
  },
  {
    text: "Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid of Giza.",
    source: "Encyclopaedia Britannica, 'Cleopatra' and 'Pyramids of Giza'",
  },
  {
    text: "Wombats leave droppings shaped like cubes.",
    source: "Yang et al., Soft Matter 17 (2021), on how wombat intestines shape their faeces",
  },
  {
    text: "A human body is made of roughly 37 trillion cells.",
    source: "Bianconi et al., Annals of Human Biology 40 (2013)",
  },
  {
    text: "There are more ways to order a deck of 52 cards than there are atoms in Earth.",
    source: "52! is about 8 × 10^67; Earth holds about 10^50 atoms",
  },
  {
    text: "The summit of Chimborazo in Ecuador is farther from Earth's centre than the top of Everest.",
    source: "NOAA National Geodetic Survey",
  },
  {
    text: "Sound travels about four times faster in water than in air.",
    source: "CRC Handbook of Chemistry and Physics, speed of sound in water and in air",
  },
  {
    text: "The shortest war on record, between Britain and Zanzibar in 1896, lasted under an hour.",
    source: "Guinness World Records, 'Shortest war'",
  },
  {
    text: "Venus is the hottest planet, hotter than Mercury, though Mercury is closer to the Sun.",
    source: "NASA Science, Venus",
  },
  {
    text: "Saturn is less dense than water.",
    source: "NASA Goddard Space Flight Center, Saturn Fact Sheet",
  },
  {
    text: "The Great Red Spot on Jupiter is a storm wider than Earth.",
    source: "NASA Science, Jupiter",
  },
  {
    text: "Butterflies taste with their feet.",
    source: "Encyclopaedia Britannica, 'Lepidopteran'",
  },
  {
    text: "Koala fingerprints are so like human ones that they are hard to tell apart under a microscope.",
    source: "Henneberg, Lambert and Leigh, Nature (1996), on koala and human fingerprints",
  },
  {
    text: "The Moon drifts away from Earth by nearly four centimetres a year.",
    source: "NASA, Lunar Laser Ranging",
  },
  {
    text: "Lightning strikes somewhere on Earth more than forty times every second.",
    source: "NASA Global Hydrometeorology Resource Center, lightning climatology",
  },
  {
    text: "A bolt of lightning is about five times hotter than the surface of the Sun.",
    source: "NOAA National Weather Service, lightning science",
  },
  {
    text: "Earth has about three trillion trees, more than there are stars in the Milky Way.",
    source: "Crowther et al., Nature 525 (2015)",
  },
  {
    text: "Tardigrades have survived being exposed to the vacuum of space.",
    source: "Jönsson et al., Current Biology 18 (2008)",
  },
  {
    text: "Pluto has not finished a single orbit of the Sun since it was discovered in 1930.",
    source: "NASA Science, Pluto",
  },
  {
    text: "The unicorn is the national animal of Scotland.",
    source: "VisitScotland, 'Scotland's national animal'",
  },
  {
    text: "Peanuts are not nuts but legumes, like peas and beans.",
    source: "Encyclopaedia Britannica, 'Peanut'",
  },
  {
    text: "Antarctica is the largest desert on Earth.",
    source: "Encyclopaedia Britannica, 'Desert'",
  },
  {
    text: "Gallium is a metal that melts in your hand.",
    source: "CRC Handbook of Chemistry and Physics, melting point of gallium",
  },
  {
    text: "Diamond and graphite are both made of nothing but carbon.",
    source: "Encyclopaedia Britannica, 'Carbon'",
  },
  {
    text: "Seen from an aeroplane, a rainbow can be a full circle.",
    source: "Met Office, 'How are rainbows formed?'",
  },
  {
    text: "The Atlantic Ocean grows a few centimetres wider every year.",
    source: "U.S. Geological Survey, 'This Dynamic Earth'",
  },
  {
    text: "A newborn baby has around 300 bones; many fuse, leaving an adult with 206.",
    source: "Encyclopaedia Britannica, 'Human skeleton'",
  },
  {
    text: "The word robot comes from a Czech word for forced labour, first used in a play in 1920.",
    source: "Encyclopaedia Britannica, 'R.U.R.'",
  },
  {
    text: "An ostrich's eye is bigger than its brain.",
    source: "Encyclopaedia Britannica, 'Ostrich'",
  },
  {
    text: "For nearly four thousand years the Great Pyramid of Giza was the tallest structure people had built.",
    source: "Encyclopaedia Britannica, 'Pyramids of Giza'",
  },
  {
    text: "The metre is defined by light: it is the distance light travels in 1/299,792,458 of a second.",
    source: "BIPM, The International System of Units (SI Brochure)",
  },
  {
    text: "A year on Mercury lasts 88 Earth days.",
    source: "NASA Goddard Space Flight Center, Mercury Fact Sheet",
  },
  {
    text: "Olympus Mons on Mars is about two and a half times as tall as Mount Everest.",
    source: "NASA Science, Mars",
  },
  {
    text: "Sea otters sometimes hold paws while they sleep, so they do not drift apart.",
    source: "Monterey Bay Aquarium, sea otter facts",
  },
  {
    text: "The deepest point of the Mariana Trench lies farther below sea level than Mount Everest rises above it.",
    source: "NOAA Ocean Exploration, 'How deep is the ocean?'",
  },
  {
    text: "Male seahorses carry the eggs and give birth to the young.",
    source: "Encyclopaedia Britannica, 'Seahorse'",
  },
  {
    text: "Honeybees tell each other where food is with a dance.",
    source: "von Frisch, The Dance Language and Orientation of Bees (1967)",
  },
  {
    text: "Dolphins can sleep with one half of the brain at a time.",
    source: "Rattenborg, Amlaner and Lima, Neuroscience and Biobehavioral Reviews 24 (2000)",
  },
  {
    text: "Crows can recognise a human face and remember it for years.",
    source: "Marzluff et al., Animal Behaviour 79 (2010)",
  },
  {
    text: "The Sun holds more than 99 percent of all the mass in the Solar System.",
    source: "NASA Science, the Sun",
  },
  {
    text: "Neptune was found by calculation before anyone saw it, from the pull it had on Uranus.",
    source: "Encyclopaedia Britannica, 'Neptune'",
  },
  {
    text: "The first photograph known to show a person was taken on a Paris street in 1838.",
    source: "Encyclopaedia Britannica, 'Louis-Jacques-Mandé Daguerre'",
  },
  {
    text: "There are more possible games of chess than atoms in the observable universe.",
    source: "Shannon, Philosophical Magazine 41 (1950)",
  },
  {
    text: "The blue whale is the largest animal known ever to have lived.",
    source: "Encyclopaedia Britannica, 'Blue whale'",
  },
  {
    text: "The Eiffel Tower grows up to about fifteen centimetres taller in the summer heat.",
    source: "Société d'Exploitation de la Tour Eiffel, the tower's official site",
  },
  {
    text: "Some kinds of bamboo can grow almost a metre in a single day.",
    source: "Guinness World Records, 'Fastest growing plant'",
  },
  {
    text: "Earth's days are slowly getting longer, by about two milliseconds a century.",
    source: "Stephenson, Morrison and Hohenkerk, Proceedings of the Royal Society A 472 (2016)",
  },
  {
    text: "Glass is made mostly from sand.",
    source: "Encyclopaedia Britannica, 'Glass'",
  },
  {
    text: "A giraffe has seven bones in its neck, the same number as a person.",
    source: "Encyclopaedia Britannica, 'Giraffe'",
  },
  {
    text: "Cats cannot taste sweetness.",
    source: "Li et al., PLoS Genetics 1 (2005)",
  },
];

/** What the fun-fact card shows: a fact, or a word from the author with its button. */
export interface WelcomeItem {
  text: string;
  link?: { label: string; url: string };
}

/** The facts and the words from the author, which take their turn among the facts. */
export const WELCOME_ROTATION: readonly WelcomeItem[] = [
  ...WELCOME_FACTS.map((f) => ({ text: f.text })),
  ...WELCOME_ASKS.map((a) => ({ text: a.text, link: { label: a.label, url: a.url } })),
];
