export function sampleBoatThreat(boat, px, pz, radius, out, leadSeconds = 1) {
  if (!boat) return false;
  const vx = boat.vel ? boat.vel.x : 0;
  const vz = boat.vel ? boat.vel.z : 0;
  const velocitySq = vx * vx + vz * vz;
  let closestX, closestZ;

  if (velocitySq > 1) {
    let time = ((px - boat.pos.x) * vx + (pz - boat.pos.z) * vz) / velocitySq;
    time = Math.max(0, Math.min(leadSeconds, time));
    closestX = boat.pos.x + vx * time;
    closestZ = boat.pos.z + vz * time;
  } else {
    closestX = boat.pos.x;
    closestZ = boat.pos.z;
  }

  let dx = px - closestX;
  let dz = pz - closestZ;
  let distance = Math.hypot(dx, dz);
  if (distance >= radius) return false;
  if (distance < 0.4 && velocitySq > 1) {
    const speed = Math.sqrt(velocitySq);
    dx = -vz / speed;
    dz = vx / speed;
    distance = 1;
  }
  const inverseDistance = 1 / (distance || 1e-3);
  out.ax = dx * inverseDistance;
  out.az = dz * inverseDistance;
  out.u = 1 - distance / radius;
  return true;
}
