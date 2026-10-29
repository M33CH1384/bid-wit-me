import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { MANSION } from './mansionLayout';
export function preloadMansionRoom(quality: 'high' | 'low' = 'high'): void { preloadCubeVenue(MANSION, quality); }
export default function MansionRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={MANSION} quality={quality} handNo={handNo} />;
}
