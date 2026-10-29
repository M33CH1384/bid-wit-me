import CubeVenueRoom, { preloadCubeVenue } from './cubeVenue';
import { BACKYARD } from './backyardLayout';
export function preloadBackyardRoom(quality: 'high' | 'low' = 'high'): void { preloadCubeVenue(BACKYARD, quality); }
export default function BackyardRoom({ quality, handNo }: { quality: 'high' | 'low'; handNo: number }) {
  return <CubeVenueRoom cfg={BACKYARD} quality={quality} handNo={handNo} />;
}
