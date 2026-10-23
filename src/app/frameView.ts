/** Decodes a RenderFrame's typed arrays into plain objects the panels can read. */
import type { BuildingKind, CitizenAction, Occupation } from "../sim/types";
import { ACTIONS, BD, BUILDING_KINDS, BUSINESS_KINDS, BZ, CZ, INFECTIONS, OCCUPATIONS } from "../workers/protocol";
import type { RenderFrame, WorldInfo } from "../workers/protocol";

export interface CitizenView {
  id: number;
  name: string;
  alive: boolean;
  occupation: Occupation;
  action: CitizenAction;
  age: number;
  needs: { food: number; shelter: number; safety: number; belonging: number };
  health: number;
  foodStock: number;
  wealth: number;
  home: number;
  workplaceBuilding: number;
  traits: string[];
  goal: string;
  settlement: number;
  infection: (typeof INFECTIONS)[number];
}

export interface BuildingView {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  tier: number;
  condition: number;
  alive: boolean;
  business: number;
  settlement: number;
}

export interface BusinessView {
  id: number;
  alive: boolean;
  kind: (typeof BUSINESS_KINDS)[number];
  building: number;
  cash: number;
  wage: number;
  employees: number;
  staffTarget: number;
  profit30: number;
  lastOutput: number;
  inventory: { food: number; materials: number; energy: number };
  owner: number;
  insolventDays: number;
}

export interface WorldView {
  citizens: CitizenView[];
  buildings: BuildingView[];
  businesses: BusinessView[];
}

export function decodeFrame(f: RenderFrame, info: WorldInfo): WorldView {
  const citizens: CitizenView[] = [];
  for (let i = 0; i < f.citizens.length; i += CZ.STRIDE) {
    const id = f.citizens[i + CZ.id];
    const meta = info.citizens[id];
    citizens.push({
      id,
      name: meta?.name ?? `#${id}`,
      alive: f.citizens[i + CZ.alive] === 1,
      occupation: OCCUPATIONS[f.citizens[i + CZ.occ]] as Occupation,
      action: ACTIONS[f.citizens[i + CZ.action]] ?? "none",
      age: f.citizens[i + CZ.age],
      needs: { food: f.citizens[i + CZ.food], shelter: f.citizens[i + CZ.shelter], safety: f.citizens[i + CZ.safety], belonging: f.citizens[i + CZ.belonging] },
      health: f.citizens[i + CZ.health],
      foodStock: f.citizens[i + CZ.foodStock],
      wealth: f.citizens[i + CZ.wealth],
      home: meta?.home ?? -1,
      workplaceBuilding: f.citizens[i + CZ.workplaceBuilding],
      traits: meta?.traits ?? [],
      goal: meta?.goal ?? "",
      settlement: f.citizens[i + CZ.settlement],
      infection: INFECTIONS[f.citizens[i + CZ.infection]] ?? "none",
    });
  }
  const buildings: BuildingView[] = [];
  for (let i = 0; i < f.buildings.length; i += BD.STRIDE) {
    buildings.push({
      id: f.buildings[i + BD.id],
      kind: BUILDING_KINDS[f.buildings[i + BD.kind]],
      x: f.buildings[i + BD.x],
      y: f.buildings[i + BD.y],
      tier: f.buildings[i + BD.tier],
      condition: f.buildings[i + BD.condition],
      alive: f.buildings[i + BD.alive] === 1,
      business: f.buildings[i + BD.business],
      settlement: f.buildings[i + BD.settlement],
    });
  }
  const businesses: BusinessView[] = [];
  for (let i = 0; i < f.businesses.length; i += BZ.STRIDE) {
    businesses.push({
      id: f.businesses[i + BZ.id],
      alive: f.businesses[i + BZ.alive] === 1,
      kind: BUSINESS_KINDS[f.businesses[i + BZ.kind]],
      building: f.businesses[i + BZ.building],
      cash: f.businesses[i + BZ.cash],
      wage: f.businesses[i + BZ.wage],
      employees: f.businesses[i + BZ.employees],
      staffTarget: f.businesses[i + BZ.staffTarget],
      profit30: f.businesses[i + BZ.profit30],
      lastOutput: f.businesses[i + BZ.lastOutput],
      inventory: { food: f.businesses[i + BZ.invFood], materials: f.businesses[i + BZ.invMat], energy: f.businesses[i + BZ.invEnergy] },
      owner: f.businesses[i + BZ.owner],
      insolventDays: f.businesses[i + BZ.insolventDays],
    });
  }
  return { citizens, buildings, businesses };
}

export const money = (cents: number): string => `${cents < 0 ? "−" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString()}`;
export const label = (s: string): string => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
