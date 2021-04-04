const { loggers, resolveSchema } = require('@asymmetrik/node-fhir-server-core');
const logger = loggers.get('default');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const Practitioner = resolveSchema('4_0_0', 'practitioner'); 
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

// convert a person record into fhir practitioner resource
async function mapPersonToPractitionerResource(person) {

    // define a new fhir practitioner resource instance
    let practitioner = new Practitioner

    // set data from person to practitioner resource instance
    practitioner.id = person.PRSN_ID;
    practitioner.gender = person.PRSN_GENDER;
    practitioner.birthDate = person.PRSN_BIRTH_DATE;
    practitioner.telecom = [{
        "system": "email",
        "value": person.PRSN_EMAIL,
        "use":"home"
        }];

    //put all name related fields in the database to resourse.name
    practitioner.name = [
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

    practitioner.identifier = await getPractitionerIdentifierThroPersonDoc(person)

    practitioner.text = {
        "status": "generated",
        "div": '<div xmlns="http://www.w3.org/1999/xhtml">' + practitioner.name[0].text + "</div>"
    };

    return practitioner
}

function getPractitionerIdentifierThroPersonDoc(person) {

    //every practitioner has the hospital_id as the default identifier, practitionerIdentifier is an array
    let practitionerIdentifier = [{
        use: "official",
        system: `https://saintmartinhospital.org`,
        value: person.PRSN_ID,
        period: {start: person.PRSN_CREATE_DATE }
    }]

    // get all personDoc records related to a person
    const db = new Database('./persondb.db', { verbose: console.log })
    const stmt = db.prepare('select * from PERSON_DOC where PERSON_DOC.PRDT_PRSN_ID = ?')
    // const personId = parseInt(person.PRSN_ID)
    const personDocArray = stmt.all(person.PRSN_ID)

    // convert DocType to system:value identifier
    personDocArray.forEach((personDoc) => {

        let item ={}
        if (personDoc.PRDT_DCTP_ID === 1) 
            item = {    use: "usual",
                            system: "https://www.national-office.gov/ni",
                            value: personDoc.PRDT_DOC_VALUE, 
                            period: {start: personDoc.PRDT_CREAT_DATE }
                        }

        if (personDoc.PRDT_DCTP_ID === 2) 
            item = {
                    use: "official",
                    system: "https://www.foreign-affairs.gov/pp",
                    value: personDoc.PRDT_DOC_VALUE, 
                    period: {start: personDoc.PRDT_CREATE_DATE }
                }

        if (personDoc.PRDT_DCTP_ID === 3) 
            item = {
                    use: "official",
                    system: "NPI",
                    value: personDoc.PRDT_DOC_VALUE, 
                    period: {start: personDoc.PRDT_CREATE_DATE }
                }

        practitionerIdentifier.push(item);
    })
    return practitionerIdentifier
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

async function mapPractitioneridentifierToPerson(identifier) {

    let identifierArray = identifier.split("|"); // [ 'https://saintmartinhospital.org/practitioner-id', '1' ]
    let identifier_system = identifierArray[0]
    let identifier_value = identifierArray[1]

    // create db connection
    const db = new Database('./persondb.db', { verbose: console.log })

    if (identifier_system === "https://saintmartinhospital.org/practitioner-id") {

        let person = db.prepare('SELECT * from PERSON WHERE PRSN_ID = ? ').get(identifier_value)

        return person

    } else {
        //use tertiary operation to conditional assign value to PRDT_DCTP_ID
        let PRDT_DCTP_ID = (identifier_system === "https://www.national-office.gov/ni") ? 1
        :(identifier_system === "https://www.foreign-affairs.gov/pp") ? 2
        :(identifier_system === "NPI") ? 3
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

    var personArray = []
    var searchCriteria = [];
    var values = []
    
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
        searchCriteria.push("PERSON.PRSN_FIRST_NAME like ? OR PERSON.PRSN_LAST_NAME like ? OR PERSON.PRSN_SECOND_NAME like ?")
        values.push(name, name, name)
    }
    //convert identifier to person and add it back to search criteria
    if (identifier) {
        let person = await mapPractitioneridentifierToPerson(identifier)  
        searchCriteria.push("PRSN_ID = ?")
        values.push(person.PRSN_ID)
    }
    
    searchCriteria = searchCriteria.join(' AND ')

    //open a database conneciton and query db with condition above
    const db = new Database('./persondb.db', { verbose: console.log })
    personArray = db.prepare(`select * from PERSON INNER JOIN PERSON_DOC ON PERSON.PRSN_ID = PERSON_DOC.PRDT_PRSN_ID WHERE PERSON_DOC.PRDT_DCTP_ID = 3 AND ${searchCriteria}`).all(values)

    // convert personArray (records from database) into an array of practitioner resource objects
    const practitionerArray = await Promise.all(
        personArray.map( async (person) => {return mapPersonToPractitionerResource(person)}) //return is also await for one promise
    )

    let baseUrl = GetBaseUrl(context)
    const count = practitionerArray.length

    //2. Assemble the practitioner objects into entries
    let entries = practitionerArray.map((practitioner) => 
        {   
            let entry = new BundleEntry
            ({
                fullUrl: baseUrl + '/Practitioner/' + practitioner.id,
                resource: practitioner
            })
            return entry
        })

    // 3. Assemble the entries into a search bundle With the type, total, entries, id, and meta
    let bundle = new Bundle({
            id: uuidv4(),
            link: [{
                relation: "self",
                url: baseUrl + "Practitioner"
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
    const stmt = db.prepare('SELECT * FROM PERSON INNER JOIN PERSON_DOC ON PERSON.PRSN_ID = PERSON_DOC.PRDT_PRSN_ID WHERE PERSON_DOC.PRDT_DCTP_ID = 3 AND PERSON.PRSN_ID = ?')
    let personFound= stmt.get(id)

    if (personFound) {

        const practitionerResource = await mapPersonToPractitionerResource(personFound)
        return practitionerResource;

        // if you are just await a single promise, you can simply return with it, no need to await for it
        // return mapPersonToPractitionerResource(personFound)

    } else {
        let OO = new OperationOutcome();
        var message = "Practitioner with id "+ id + " not found ";
        OO.issue = [{
            "severity": "error",
            "code": "processing",
            "diagnostics": message
        }]
        return OO;
    }    
}

module.exports = {
    mapPersonToPractitionerResource,
    getPractitionerIdentifierThroPersonDoc,
    mapPractitioneridentifierToPerson,
    createPersonDocRecord,
    search, 
    searchById
}