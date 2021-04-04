const { loggers, resolveSchema } = require('@asymmetrik/node-fhir-server-core');
const logger = loggers.get('default');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const Patient = resolveSchema('4_0_0', 'patient'); // const Patient = resolveSchema(args.base_version, 'patient'); args not available yet, so put in version directly
const BundleEntry = resolveSchema('4_0_0', 'bundleentry');
const Bundle = resolveSchema('4_0_0', 'bundle');
const OperationOutcome = resolveSchema('4_0_0','operationoutcome');

//Meta data for FHIR R4
let getMeta = (base_version) => {
    return require(FHIRServer.resolveFromVersion(base_version, RESOURCES.META));
};

function GetBaseUrl(context) {
    var baseUrl = "";
    const FHIRVersion = "/4_0_0/";
    var protocol = "http://";
    if (context.req.secure) { protocol = "https://"; }
    baseUrl = protocol + context.req.headers.host + FHIRVersion;
    return baseUrl;
}

// convert a person record into fhir patient resource
async function mapPersonToPatientResource(person) {

    // define a new fhir patient resource instance
    let patient = new Patient

    // set data from person to patient resource instance
    patient.id = person.PRSN_ID;
    patient.gender = person.PRSN_GENDER;
    patient.birthDate = person.PRSN_BIRTH_DATE;
    patient.telecom = [{
        "system": "email",
        "value": person.PRSN_EMAIL,
        "use":"home"
        }];

    //put all name related fields in the database to resourse.name
    patient.name = [
        {   
            use: "official",
            family: person.PRSN_LAST_NAME,
            given: [person.PRSN_FIRST_NAME, person.PRSN_SECOND_NAME],
            text: person.PRSN_FIRST_NAME + " " + person.PRSN_LAST_NAME
        }, 
        {   use: "nickname",
            given: [ person.PRSN_NICK_NAME ]
        }
    ]

    patient.identifier = await getPatientIdentifierThroPersonDoc(person)

    patient.text = {
        "status": "generated",
        "div": '<div xmlns="http://www.w3.org/1999/xhtml">' + patient.name[0] + "</div>"
    };

    return patient
}

function getPatientIdentifierThroPersonDoc(person) {

    //every patient has the hospital_id as the default identifier, patientIdentifier is an array
    let patientIdentifier = [{
        use: "official",
        system: "https://saintmartinhospital.org/patient-id",
        value: person.PRSN_ID,
        period: {start: person.PRSN_CREATE_DATE }
    }]

    // get all personDoc records related to a person
    const db = new Database('./persondb.db', { verbose: console.log })
    const stmt = db.prepare(`select * from PERSON_DOC where PERSON_DOC.PRDT_PRSN_ID = ?`)
    const personId = parseInt(person.PRSN_ID)
    const personDocArray = stmt.all(personId)

    // convert DocType to system:value identifier
    personDocArray.forEach( (personDoc) => {
        switch (personDoc.PRDT_DCTP_ID) {
            case "1":
                patientIdentifier.push({
                    use: "usual",
                    system: "https://www.national-office.gov/ni",
                    value: personDoc.PRDT_DOC_VALUE, 
                    period: {start: personDoc.PRDT_CREAT_DATE }
                });
                break;

            case "2":
                patientIdentifier.push({
                    use: "official",
                    system: "https://www.foreign-affairs.gov/pp",
                    value: personDoc.PRDT_DOC_VALUE, 
                    period: {start: personDoc.PRDT_CREATE_DATE }
                });
                break;
            default: 
                break;
        } 
    })

    return patientIdentifier
}

function createPersonDocRecord(personId,identifier) {

    let personDocObj={};

    personDocObj.PRDT_PRSN_ID = personId,
    // personDocObj.PRDT_DCTP_ID = (identifier.system === "https://www.national-office.gov/ni") ? 1:2

    personDocObj.PRDT_DCTP_ID = 
        (identifier.system === "https://www.national-office.gov/ni") ? 1
        :(identifier.system === "https://www.foreign-affairs.gov/pp") ? 2
        :null

    personDocObj.PRDT_DOC_VALUE = identifier.value
    personDocObj.PRDT_CREATE_DATE = new Date().toISOString(),
    personDocObj.PRDT_DELETE_DATE = ''

    const columnNames = "(PRDT_PRSN_ID, PRDT_DCTP_ID, PRDT_DOC_VALUE, PRDT_CREATE_DATE, PRDT_DELETE_DATE)"
    
    const db = new Database('./persondb.db', { verbose: console.log })
    const stmt = db.prepare(`INSERT INTO PERSON_DOC ${columnNames} VALUES (?, ?, ?, ?, ?)`);
    const info = stmt.run(personDocObj.PRDT_PRSN_ID, personDocObj.PRDT_DCTP_ID, personDocObj.PRDT_DOC_VALUE, personDocObj.PRDT_CREATE_DATE, personDocObj.PRDT_DELETE_DATE );

}

async function mapPatientidentifierToPerson(identifier) {

    let identifierArray = identifier.split("|"); // [ 'https://saintmartinhospital.org/patient-id', '1' ]
    let identifier_system = identifierArray[0]
    let identifier_value = identifierArray[1]

    // create db connection
    const db = new Database('./persondb.db', { verbose: console.log })

    if (identifier_system === "https://saintmartinhospital.org/patient-id") {

        let person = db.prepare('SELECT * from PERSON WHERE PRSN_ID = ? ').get(identifier_value)

        return person

    } else {
        //use tertiary operation to conditional assign value to PRDT_DCTP_ID
        let PRDT_DCTP_ID = (identifier_system === "https://www.national-office.gov/ni") ? 1
        :(identifier_system === "https://www.foreign-affairs.gov/pp") ? 2
        :null

        // filter persons with the specific docType and doc_value
        let stmt = db.prepare('SELECT * from PERSON where PERSON.PRSN_ID = (SELECT PRDT_PRSN_ID from PERSON_DOC WHERE PRDT_DCTP_ID = ? AND PRDT_DOC_VALUE = ?)');
        let person = stmt.get(PRDT_DCTP_ID, identifier_value)
        return person
    }
}

async function search(args, context) { 

    //Our server offer search with these search parameters: family, gender, birthdate, _id, email, name
    const {base_version, _id, _COUNT} = args;
    const {family, gender, birthdate, email, name, identifier} = args;

    var searchCriteria = [];
    var values = []
    var personArray = []

    // Convert args to stmt clause. If a request contains a specific search parameter, we create a stmt for each query parameter
    if (family) { 
        searchCriteria.push("PRSN_LAST_NAME = ?")
        values.push(family)
        }
    if (gender) { 
        searchCriteria.push("PRSN_GENDER = ?")
        values.push(gender)
        }
    if (birthdate) { 
        searchCriteria.push("PRSN_BIRTH_DATE = ?");
        values.push(birthdate)
        }
    if (_id) { 
        searchCriteria.push("PRSN_ID = ?")
        values.push(_id)
        }
    if (email) {
        searchCriteria.push("PRSN_EMAIL = ?")
        values.push(email)
        }
    if (name) { 
        searchCriteria.push("PRSN_FIRST_NAME like ? OR PRSN_LAST_NAME like ? OR PRSN_SECOND_NAME like ?")
        values.push(name, name, name)
    }
    if (identifier) {
        //identifier correlate to one person
        let person = await mapPatientidentifierToPerson(identifier)
        personArray.push(person)
    }
    
    searchCriteria = searchCriteria.join(' AND ')

    //open a database conneciton and query db with condition above
    const db = new Database('./persondb.db', { verbose: console.log })
    let rows = db.prepare(`select * from PERSON WHERE ${searchCriteria}`).all(values)

    // combine main search with identifier search
    combined = [...personArray, ...rows]
    // keep unique persons using set properties
    personArray = [...new Set(combined)]
    
    // convert person records into an patient resource objects
    const patientArray = await Promise.all(
        personArray.map( async (person) => {return mapPersonToPatientResource(person)}) //return is also await for one promise
    )

    let baseUrl = GetBaseUrl(context)
    const count = patientArray.length

    //2. Assemble the patient objects into entries
    let entries = patientArray.map((patient) => 
        {   
            let entry = new BundleEntry
            ({
                fullUrl: baseUrl + '/Patient/' + patient.id,
                resource: patient
            })
            return entry
        })

    // 3. Assemble the entries into a search bundle With the type, total, entries, id, and meta
    let bundle = new Bundle({
            id: uuidv4(),
            link: [{
                relation: "self",
                url: baseUrl + "Patient"
            }],
            meta: { lastUpdated: new Date()},
            type: "searchset",
            total: count,
            entry: entries
        })
    return bundle;
}    

async function searchById(args) {

    let { base_version, id } = args;

    const db = new Database('./persondb.db', { verbose: console.log })
    const stmt = db.prepare('select * from PERSON WHERE PRSN_ID = ?')
    let personFound= stmt.get(id)

    if (personFound) {

        const patientResource = await mapPersonToPatientResource(personFound)
        return patientResource;

        // if you are just await a single promise, you can simply return with it, no need to await for it
        // return mapPersonToPatientResource(personFound)

    } else {
        let OO = new OperationOutcome();
        var message = "Patient with id "+ id + " not found ";
        OO.issue = [{
            "severity": "error",
            "code": "processing",
            "diagnostics": message
        }]
        return OO;
    }    
}

//The incoming request has context, which has one "req" object, which has request body,  which contains resourse. //Note: Only JSON is supported
// we extract values from request body and set it to different fields in the data table
async function create(args, context) {

    // Extract person values from context.req.body
    resource = context.req.body;

    let lastName = resource.name[0].family;
    let firstName = resource.name[0].given[0];
    // use tertiary operator to provide value conditionally
    let secondName =  (resource.name[0].given[1]) ? resource.name[0].given[1] : "N/A"
    let birthDate = resource.birthDate;
    let gender = resource.gender;
    let email = resource.telecom[0].value;
    let nickname = resource.name[1].given[0];
    let createdAt = new Date().toISOString()
    // let updatedAt = " "

    // Match value to keys(columnNames)
    let columnNames = "(PRSN_FIRST_NAME,PRSN_SECOND_NAME,PRSN_LAST_NAME,PRSN_BIRTH_DATE,PRSN_GENDER,PRSN_EMAIL,PRSN_NICK_NAME,PRSN_CREATE_DATE)"

    const db = new Database('./persondb.db', { verbose: console.log })

    const stmt = db.prepare(`INSERT INTO PERSON ${columnNames} VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const info = stmt.run(firstName, secondName,lastName, birthDate, gender, email, nickname, createdAt);

    //Server assigned a new personId for the new person we created, which is stored in the info object (better-sqlite3 created it)
    let personId = info.lastInsertRowid
    // create this new person's related PERSON_DOC record(s) from patient resource's identifier data
    
    //The request has the identifier data stored in resource.identifier (an array)
    // We use the new personId and the identifier info from the req.resource to create new PERSON_DOC record(s)
    await resource.identifier.forEach((identifier) => {
        createPersonDocRecord(personId,identifier)
    })

    //We create the response object, which has the personId of the newly created person.
    return {
        id: personId,
      };
    // db.close();
}

module.exports = {
    mapPersonToPatientResource,
    getPatientIdentifierThroPersonDoc,
    mapPatientidentifierToPerson,
    createPersonDocRecord,
    search, 
    searchById,
    create
}