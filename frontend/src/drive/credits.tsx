import { TRUCK_CREDIT, TRUCK_LICENSE, TRUCK_MODIFICATIONS, TRUCK_SOURCE } from './modelConfig';
export function TruckCredit() {
  return <><a href={TRUCK_SOURCE} target="_blank" rel="noreferrer">{TRUCK_CREDIT}</a> is licensed under <a href={TRUCK_LICENSE} target="_blank" rel="noreferrer">CC0</a>. {TRUCK_MODIFICATIONS}</>;
}
