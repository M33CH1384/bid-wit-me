import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { GRANDMA } from './grandmaLayout';
export function preloadGrandmaRoom(quality: 'high' | 'low' = 'high'): void { preloadCubeVenue(GRANDMA, quality); }
export default function GrandmaRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={GRANDMA} quality={quality} handNo={handNo} />;
}
