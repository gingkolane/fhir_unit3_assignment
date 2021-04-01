const { loggers, resolveSchema } = require('@asymmetrik/node-fhir-server-core');
const logger = loggers.get('default');
const sqlite3 = require('sqlite3').verbose();

// convert a MedicationRequest table record into fhir medicationRequest resource
async function mapMedReqToMedReqResource(medReq) {
    // Create a medicationRequest resource of correct base_version of node-fhir-server-core
    let MR = resolveSchema(args.base_version, 'medicationRequest');

    medReq.id 
    medReq.

    // give medicationRequest data to medicationRequest
    MR.id = MRrecord.id;
    MR.identifier = MRrecord.identifier
    MR.status = MRrecord.status	
    MR.intent = MRrecord.intent 
    MR.medicationCodableConcept = MRrecord.medicationCodableConcept 
    MR.medicationReference = MRrecord.medicationReference
    MR.subject = MRrecord.subject
    MR.authoredOn = MRrecord.authoredOn
    MR.requester = MRrecord.practitioner_id
    MR.dosageInstruction = MRrecord.dosageInstruction
    MR.expectedSupplyDuration = MRrecord.expectedSupplyDuration

    return MR
}


//server offer search with these search parameters: family, gender, birthdate, _id, email, name
async function searchByPatientID(args, context) { 

    // search parameters: baseURL/MedicationRequest?patient=1

    //open a database conneciton and query db with where condition
    const db = new sqlite3.Database('./persondb.db');

    let sql = `select * from MedicationRequest WHERE person_id = ?`

    const foundMR = db.get(sql,[args['patient']],(err, row) => {
        if (err) { throw err };
        if (rows === null) {return operatinOutcome}
        if (row) {
            console.log(row)
            return mapMedReqToMedReqResource(person)})
            }
        });

    db.close()

    let BundleEntry = resolveSchema(args.base_version, 'bundleentry');
    let Bundle = resolveSchema(args.base_version, 'bundle');

    let entries = foundMR.map((medicationRequest) => new BundleEntry({ resource: medicationRequest }));
    return new Bundle({ entry: entries });
};


async function searchById(args, context) {
    
    const db = new sqlite3.Database('./persondb.db')

    let sql = `select * from PERSON where PRSN_ID = ?`

    let medicationRequest = db.get(sql, [args[_id]], (err,row) => {
        if (err) { throw err}
        if (row === null) {operationOutcome read}
        if (row) {
            (person) => {return mapPersonToPatientResource(person)}
        }
    } )

    return medicationRequest
}



module.exports = {
    mapPersonToPatientResource,
    mapPersonDocToPatientIdentifier,
    createPersonDocRecord,
    search, 
    searchById,
    create
}