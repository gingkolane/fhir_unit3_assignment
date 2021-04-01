// require the Asymmetrik FHIR Server
const FHIRServer = require('@asymmetrik/node-fhir-server-core');

const base_version = '4_0_0';

let customCapabilityStatement = (resources) => {
    let CapabilityStatement = FHIRServer.resolveSchema(base_version, 'CapabilityStatement');

  return new CapabilityStatement({
    status: 'draft',
    date: '20190418',
    publisher: 'The Publisher',
    kind: 'instance',
    software: {
      name: 'My super cool Software',
      version: '1.0.0',
      releaseDate: '20190418',
    },
    implementation: {
      description: 'Your FHIR Server',
      url: 'http://yourfhirserver.com/',
    },
    fhirVersion: base_version.replace(/_/g, '.'),
    acceptUnknown: 'extensions',
    format: ['application/fhir+json'],
    rest: resources,
  });
};

/**
 * Generates a custom Security Statement
 * @param {object} securityUrls - This is separate from the Capability Statement. It provides information about the Security of the current implementation.
 * If provided, this will be derived from the information you pass to the 'Security' property from the FHIR Server Config.
 * The below Security Statement is returned by default. This is probably only a place holder for now.
 */
let customSecurityStatement = (securityUrls) => {
  return {
    cors: true,
    service: [
      {
        coding: [
          {
            system: 'http://hl7.org/fhir/restful-security-service',
            code: 'SMART-on-FHIR',
          },
        ],
        text: 'Custom OAuth2 using SMART-on-FHIR profile (see http://docs.smarthealthit.org)',
      },
    ],
    extension: [
      {
        url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
        extension: securityUrls,
      },
    ],
  };
};

/**
 * Exports Custom functions to be used in Server Configuration
 * @param {object} args - This will pass us the FHIR Spec Version of the Capability Statement. This comes from the route you're hitting.
 */
 module.exports.generateStatements = (args) => {
    base_version = args.base_version;
    return {
      makeStatement: customCapabilityStatement,
      securityStatement: customSecurityStatement,
    };
  };