import { calibrate, EyeSignalProcessor } from '../src/core/eyeSignal';
import { frames } from '../tests/synthetic';
for (const [noise, open] of [[0.04,0.08],[0.10,0.08],[0.04,0.30]]) {
  // emulate: relaxed with natural blinks
  const relaxed = frames([{ms:3000,closure:open},{ms:250,closure:0.72},{ms:3000,closure:open},{ms:300,closure:0.72},{ms:3000,closure:open}]);
  const c = calibrate({relaxed, closed: frames([{ms:2000,closure:0.72}])});
  console.log(noise, open, JSON.stringify({o:c.openClosure.toFixed(2),c:c.closedClosure.toFixed(2),sel:c.selectMinMs,nb:c.naturalBlinks.length}));
}
