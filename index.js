const { initialize, loggers, constants } = require('@asymmetrik/node-fhir-server-core');
const { VERSIONS } = constants;


let config = {
  profiles: {
    patient: {
      service: './patient.service.js',
      versions: [VERSIONS['4_0_0']],
    },
    practitioner: {
      service: './practitioner.service.js',
      versions: [VERSIONS['4_0_0']],
    }
  }
};

let server = initialize(config);
let logger = loggers.get('default');

server.listen(3005, () => {
  logger.info('Starting the FHIR Server at localhost:3005');
});