import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { BEACH } from './beachLayout';
export function preloadBeachRoom(): void { preloadCubeVenue(BEACH); }
export default function BeachRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={BEACH} quality={quality} handNo={handNo} />;
}
