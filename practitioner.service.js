const { loggers, resolveSchema } = require('@asymmetrik/node-fhir-server-core');
const logger = loggers.get('default');
const sqlite3 = require('sqlite3').verbose();

// convert a practitioner record into fhir practitioner resource
async function mapPractitionerToPractitionerResource(practitioner) {
    // Create a practitioner resource of correct base_version of node-fhir-server-core
    let practitioner = resolveSchema(args.base_version, 'practitioner');

    // give practitioner data to practitioner
    practitioner.id = practitioner.PRSN_ID.toString();
    practitioner.gender = practitioner.PRSN_GENDER;
    practitioner.birthDate = practitioner.PRSN_BIRTH_DATE;
    practitioner.telecom = [{
        "system": "email",
        "value": practitioner.PRSN_EMAIL.toString(),
        "use":"home"
        }];

    //put all name related fields in the database to resourse.name
    practitioner.name = [
        {   
            use: "official",
            family: practitioner.PRSN_LAST_NAME,
            given: [practitioner.PRSN_FIRST_NAME, practitioner.PRSN_SECOND_NAME],
            text: practitioner.PRSN_FIRST_NAME + " " + practitioner.PRSN_LAST_NAME
        }, 
        {   use: "nickname",
            given: [ practitioner.PRSN_NICK_NAME ]
        }
    ]

    practitioner.identifier = await mapPersonDocToPractitionerIdentifier(practitioner) 

    practitioner = {
        "status": "generated",
        "div": '<div xmlns="http://www.w3.org/1999/xhtml">' + R.name[0] + "</div>"
    };

    return practitioner
}

// convert practitioner doc information into practitioner identifier
async function mapPersonDocToPractitionerIdentifier(practitioner) {

    //open a database conneciton
    const db = new sqlite3.Database('./practitionerdb.db');

    let sql = `select * from PERSON_DOC where PERSON_DOC.PRDT_PRSN_ID = ?`;

    db.each(sql, [practitioner.PRSN_ID],(err, practitionerDocs) => {

        if (err) { throw err };

        if (practitionerDocs) {

            let practitionerIdentifier = []

            practitionerDocs.forEach((practitionerDoc) => { 
                switch (practitionerDoc.PRDT_DCTP_ID) {
                    case "1":
                        practitionerIdentifier.push({
                            use: "usual",
                            system: "https://www.national-office.gov/ni",
                            value: practitionerDoc[PRDT_DOC_VALUE], 
                            period: {start: practitionerDoc.PRDT_CREAT_DATE }
                        });
                        return practitionerIdentifier

                    case "2":
                        practitionerIdentifier.push({
                            use: "official",
                            system: "https://www.foreign-affairs.gov/pp",
                            value: practitionerDoc.PRDT_DOC_VALUE, 
                            period: {start: practitionerDoc.PRDT_CREAT_DATE }
                        });
                        return practitionerIdentifier

                    default: 
                        practitionerIdentifier.push({
                            use: "official",
                            system: "https://saintmartinhospital.org/practitioner-id",
                            value: practitioner.PRSN_ID.toString(),
                            period: {start: record.PRDT_CREAT_DATE }
                        });
                        return practitionerIdentifier
                }
            })
        }
    })

    db.close()
}

//server offer search with these search parameters: family, gender, birthdate, _id, email, name
async function search(args, context) { 

    // Convert args to where condition clause. If a request contains a specific search parameter, we add it to condition clauses.
    let condition = [];

    if (args['family']) { condition.push(`PRSN_LAST_NAME like "${args['family']}"`)}

    if (args['gender']) { condition.push(`PRSN_GENDER like "${args['gender']}"`)}

    if (args['birthdate']) { condition.push(`PRSN_BIRTH_DATE like "${args['birthdate']}"`)}

    if (args['_id']) { condition.push(`PRSN_ID like "${args['_id']}"`)}

    if (args['email']) { condition.push(`PRSN_EMAIL like "${args['email']}"`)}

    if (args['name']) { 
        const nameReg = "%" + args['name'] + "%"
        condition.push(`select * from Practitioner where PRSN_LAST_NAME like "${nameReg}" OR PRSN_FIRST_NAME like "${nameReg}" OR PRSN_SECOND_NAME like "${nameReg}"`)
    }

    condition = condition.join(' AND ')

    //open a database conneciton and query db with where condition
    const db = new sqlite3.Database('./practitionerdb.db');
  
    let sql = `select * from PERSON WHERE ${condition}`;

    const foundPractitioners = db.each(sql,(err, rows) => {
        if (err) { throw err };
        if (rows === null) {return []}
        if (rows) {
            rows.map((practitioner) => { return mapPractitionerToPractitionerResource(practitioner)})
            }
        });

    db.close()

    let BundleEntry = resolveSchema(args.base_version, 'bundleentry');
    let Bundle = resolveSchema(args.base_version, 'bundle');

    let entries = foundPractitioners.map((practitioner) => new BundleEntry({ resource: practitioner }));
    return new Bundle({ entry: entries });
};


async function searchById(args, context) {
    
    const db = new sqlite3.Database('./persondb.db')

    let sql = `select * from Practitioner where PRSN_ID = ?`

    let practitioner = db.get(sql, [args[_id]], (err,row) => {
        if (err) { throw err}
        if (row === null) {operationOutcome read}
        if (row) {
            (practitioner) => {return mapPractitionerToPractitionerResource(practitioner)}
        }
    } )

    return practitioner
}

module.exports = {
    mapPractitionerToPractitionerResource,
    mapPersonDocToPractitionerIdentifier,
    search, 
    searchById
}