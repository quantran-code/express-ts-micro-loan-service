import app from './app';
import { config } from './config';

app.listen(config.port, () => {
  console.log(`loan-service listening on port ${config.port} (${config.env})`);
});
