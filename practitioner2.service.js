const { loggers, resolveSchema } = require('@asymmetrik/node-fhir-server-core');
const logger = loggers.get('default');
const { v4: uuidv4 } = require('uuid');
const Patient = resolveSchema('4_0_0', 'patient'); // const Patient = resolveSchema(args.base_version, 'patient'); args not available yet, so put in version directly
const BundleEntry = resolveSchema('4_0_0', 'bundleentry');
const Bundle = resolveSchema('4_0_0', 'bundle');
const OperationOutcome = require('@asymmetrik/node-fhir-server-core/src/server/resources/4_0_0/schemas/operationoutcome');
const Database = require('better-sqlite3');

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
function mapPersonToPatientResource(person) {

    // define a new fhir patient resource instance
    let patient = new Patient

    // set data from person to patient resource instance
    patient.id = person.PRSN_ID.toString();
    patient.gender = person.PRSN_GENDER;
    patient.birthDate = person.PRSN_BIRTH_DATE;
    patient.telecom = [{
        "system": "email",
        "value": person.PRSN_EMAIL.toString(),
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

    patient.identifier = mapPersonDocToPatientIdentifier(person)

    patient.text = {
        "status": "generated",
        "div": '<div xmlns="http://www.w3.org/1999/xhtml">' + patient.name[0] + "</div>"
    };

    return patient
}

// convert person doc information into patient identifier
function mapPersonDocToPatientIdentifier(person) {
    //every patient has the hospital_id as the default identifier
    let patientIdentifier = [{
        use: "official",
        system: "https://saintmartinhospital.org/patient-id",
        value: person.PRSN_ID,
        period: {start: person.PRSN_CREATE_DATE }
    }]

    //open a database conneciton and get all personDoc records related to a person
    const db = new Database('./persondb.db', { verbose: console.log })
    const stmt = db.prepare(`select * from PERSON_DOC where PERSON_DOC.PRDT_PRSN_ID = ?`)
    const personDocArray = stmt.all('person.PRSN_ID')

    // convert DocType to system:value identifier
    personDocArray.forEach((personDoc) => {
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
        return patientIdentifier;
    })

}

function mapPatientIdentifierToPatient(identifier) {

    let identifierArray = identifier.split("|"); // [ 'https://saintmartinhospital.org/patient-id', '1' ]
    let identifier_system = identifierArray[0]
    let identifier_value = identifierArray[0]

    if (identifier_system === "https://saintmartinhospital.org/patient-id") {
        return searchById(identifier_value)
        }
    
    if (identifier_system === "https://www.national-office.gov/ni") {PRDT_DCTP_ID = 1}
        
    if (identifier_system === "https://www.foreign-affairs.gov/pp") {PRDT_DCTP_ID = 2}

    // filter persons with the specific docType
    let stmt_docType= db.prepare('select PRDT_PRSN_ID from PERSON_DOC WHERE PRDT_DCTP_ID like ?');
    let personArray1 = stmt_docType.all(PRDT_DCTP_ID)

    //find all persons of the docValue
    const stmt_docValue = db.prepare('select PRDT_PRSN_ID from PERSON_DOC WHERE PRDT_DOC_VALUE like ?');
    let personArray2 = stmt_docValue.all(identifier_value)

    let personArray = [...personArray1, ...personArray2]
    let uniqueArray = [...new Set(personArray)];
    foundPerson = uniqueArray[0]
    return searchById(foundPerson.id)
}

function createOnePersonDocRecord(personId,identifier) {

    let personDocObj;

    personDocObj.PRDT_PRSN_ID = personId,
    personDocObj.PRDT_DOC_VALUE = identifier.value
    personDocObj.PRDT_CREATE_DATE = new Date().toISOString(),
    personDocObj.PRDT_DELETE_DATE = ''
    if (identifier.system === "https://www.national-office.gov/ni") personDocObj.PRDT_DCTP_ID = 1
    if (identifier.system === "https://www.foreign-affairs.gov/pp") personDocObj.PRDT_DCTP_ID = 2

    const personDocValues = personDocObj.values.join(',')

    const columnNames = (
        // "PRDT_ID", 
        "PRDT_PRSN_ID",
        "PRDT_DCTP_ID",
        "PRDT_DOC_VALUE",
        "PRDT_CREATE_DATE",
        "PRDT_DELETE_DATE"
        )
    
    const db = new Database('./persondb.db', { verbose: console.log })

    const stmt = db.prepare(`INSERT INTO PERSON_DOC ${columnNames} VALUES (?, ?, ?, ?, ?)`);
    const info = stmt.run(personDocValues);

    // info.lastInsertRowid: the rowid of the last row inserted
    return info.lastInsertRowId
    db.close();
}

async function search(args, context) { 

    //Our server offer search with these search parameters: family, gender, birthdate, _id, email, name
    const {base_version, _id, _COUNT} = args;
    const {family, gender, birthDate, email, name, identifier} = args;

    //open a database conneciton and query db with condition above
    const db = new Database('./persondb.db', { verbose: console.log })
    let stmt ='';
    let personArray = [];
    // Convert args to stmt clause. If a request contains a specific search parameter, we create a stmt for each query parameter
    if (family) { 
        stmt = db.prepare('select * from PERSON WHERE PRSN_LAST_NAME = ?')
        personArray = stmt.all(family)
        }
    if (gender) { 
        stmt = db.prepare('select * from PERSON WHERE PRSN_GENDER = ?')
        personArray = stmt.all(gender)
        }
    if (birthDate) { 
        stmt = db.prepare('select * from PERSON WHERE PRSN_BIRTH_DATE = ?')
        personArray = stmt.all(birthdate)
        }
    if (_id) { 
        stmt = db.prepare('select * from PERSON WHERE PRSN_ID = ?')
        personArray= stmt.all(_id)
        }
    if (email) {
        stmt = db.prepare('select * from PERSON WHERE PRSN_EMAIL = ?')
        personArray = stmt.all(email)
        }
    if (name) { 
        // stmt = db.prepare(`select * from PERSON WHERE PRSN_LAST_NAME like ${name} OR PRSN_FIRST_NAME like ${name} OR PRSN_SECOND_NAME like ${name}`);
        stmt1 = db.prepare('select * from PERSON WHERE PRSN_FIRST_NAME like ?');
        let personArray1 = stmt1.all(name)

        stmt2 = db.prepare('select * from PERSON WHERE PRSN_LAST_NAME like ?');
        let personArray2 = stmt2.all(name)

        stmt3 = db.prepare('select * from PERSON WHERE PRSN_SECOND_NAME like ?');
        let personArray3 = stmt3.all(name)

        personArray = [...personArray1, ...personArray2, ...personArray3]

    }
    if (identifier) { return mapPatientIdentifierToPatient(identifier)}
    
    // convert person records into an patient resource object arrays
    let patientArray = personArray.map(person => {return mapPersonToPatientResource(person)});
    let baseUrl = GetBaseUrl(context)
    const count = patientArray.length

    //2. Assemble the patient objects into entries
    let entries = patientArray.map((patient) => 
        {   
            let entry = new BundleEntry({
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
            meta: { astUpdated: new Date()},
            type: "searchset",
            total: count,
            entry: entries
        })
    return bundle;
}    

function searchById(args, context) {
    
    
    let { base_version, id } = args;

    const db = new Database('./persondb.db', { verbose: console.log })
    const stmt = db.prepare('select * from PERSON WHERE PRSN_ID = ?')
    let personFound= stmt.get(id)

    if (personFound) {
        return mapPersonToPatientResource(personFound)
    } else {
        let OO = new OperationOutcome();
        var message = "Patient with identifier "+ id + " not found ";
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
function create(args, context) {

    // Extract person values from context.req.body
    resource = context.req.body;

    lastName = resource.name[0].family;
    firstName = resource.name[0].given[0];
    secondName = resource.name[0].given[1];
    birthDate = resource.birthDate;
    gender = resource.gender;
    email = resource.telecom[0].value;
    nickname = resource.name[1].given[0];
    createdAt = new Date().toISOString()
    updatedAt = " "

    // Match value to keys(columnNames)
    let columnNames = '"PRSN_FIRST_NAME","PRSN_SECOND_NAME","PRSN_LAST_NAME","PRSN_BIRTH_DATE", "PRSN_GENDER","PRSN_EMAIL","PRSN_NICK_NAME","PRSN_CREATE_DATE"'

    let personValues = `firstName,secondName,lastName,birthDate,gender,email,nickname,createdAt`

      const db = new Database('./persondb.db', { verbose: console.log })

      const stmt = db.prepare(`INSERT INTO PERSON (${columnNames}) VALUES (?, ?, ?, ?, ?, ?, ?,?)`);
      const info = stmt.run(personValues);

      // info.lastInsertRowid: the rowid of the last row inserted
      let newId = info.lastInsertRowId
        //This is the new resource id (server assigned)
        personId = newId
        resource.identifier.forEach((identifier) => {
            return createOnePersonDocRecord(personId,identifier)
        })

      db.close();
}

module.exports = {
    mapPersonToPatientResource,
    mapPersonDocToPatientIdentifier,
    mapPatientIdentifierToPatient,
    createOnePersonDocRecord,
    search, 
    searchById,
    create
}