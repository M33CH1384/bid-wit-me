import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { BACKYARD } from './backyardLayout';
export function preloadBackyardRoom(): void { preloadCubeVenue(BACKYARD); }
export default function BackyardRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={BACKYARD} quality={quality} handNo={handNo} />;
}
