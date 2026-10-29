import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { BEACH } from './beachLayout';
export function preloadBeachRoom(quality: 'high' | 'low' = 'high'): void { preloadCubeVenue(BEACH, quality); }
export default function BeachRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={BEACH} quality={quality} handNo={handNo} />;
}
