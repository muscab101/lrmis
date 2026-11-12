import { describe, expect, it } from "vitest";
import { parseCsv, parseMysqlDump, parseValues, splitStatements } from "../../lib/migration/source";

const DUMP = `-- MySQL dump 10.13
/*!40101 SET NAMES utf8mb4 */;
DROP TABLE IF EXISTS \`tbl_account\`;
CREATE TABLE \`tbl_account\` (
  \`acc_id\` int(11) NOT NULL AUTO_INCREMENT,
  \`acc_code\` varchar(20) NOT NULL,
  \`acc_name\` varchar(200) DEFAULT NULL COMMENT 'name; with semicolon',
  \`acc_type\` enum('A','L','E','I','X') NOT NULL DEFAULT 'A',
  PRIMARY KEY (\`acc_id\`),
  UNIQUE KEY \`uq_code\` (\`acc_code\`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;
INSERT INTO \`tbl_account\` VALUES (1,'1001','Cash; main box','A'),(2,'4001','Property tax','I'),(3,'5001','O\\'Brien\\'s fees',NULL);
CREATE TABLE \`tbl_journal_line\` (
  \`id\` bigint unsigned NOT NULL,
  \`jv_no\` varchar(20) NOT NULL,
  \`acc_id\` int NOT NULL,
  \`amount\` decimal(14,2) NOT NULL,
  KEY \`fk_acc\` (\`acc_id\`),
  CONSTRAINT \`fk_acc\` FOREIGN KEY (\`acc_id\`) REFERENCES \`tbl_account\` (\`acc_id\`)
);
INSERT INTO tbl_journal_line (id, jv_no, acc_id, amount) VALUES (1, 'JV-1', 1, 40.50), (2, 'JV-1', 2, -40.50), (2, 'JV-1', 2, -40.50);
`;

describe("reading a MySQL dump", () => {
  it("splits statements on ; but not inside strings or comments", () => {
    const s = splitStatements("SELECT 'a;b'; -- c;\nSELECT `x;y`; /* d; */ SELECT 1");
    expect(s).toEqual(["SELECT 'a;b'", "SELECT `x;y`", "SELECT 1"]);
  });

  it("reads values: strings with escapes, NULL, numbers, big IDs as text", () => {
    expect(parseValues("(1,'a\\'b',NULL,-2.5,12345678901234567890),('x''y',0)")).toEqual([
      [1, "a'b", null, -2.5, "12345678901234567890"],
      ["x'y", 0],
    ]);
  });

  it("finds tables, columns, keys, links, rows and repeated rows", () => {
    const [acc, lines] = parseMysqlDump(DUMP);
    expect(acc!.name).toBe("tbl_account");
    expect(acc!.columns.map((c) => [c.name, c.type, c.nullable])).toEqual([
      ["acc_id", "int(11)", false],
      ["acc_code", "varchar(20)", false],
      ["acc_name", "varchar(200)", true],
      ["acc_type", "enum('a','l','e','i','x')", false],
    ]);
    expect(acc!.primary_key).toEqual(["acc_id"]);
    expect(acc!.indexes).toEqual([{ name: "uq_code", columns: ["acc_code"], unique: true }]);
    expect(acc!.rows[0]).toEqual({ acc_id: 1, acc_code: "1001", acc_name: "Cash; main box", acc_type: "A" });
    expect(acc!.rows[2]!.acc_name).toBe("O'Brien's fees");
    expect(acc!.stats.nulls.acc_type).toBe(1);
    expect(lines!.foreign_keys).toEqual([{ columns: ["acc_id"], ref_table: "tbl_account", ref_columns: ["acc_id"] }]);
    expect(lines!.row_count).toBe(3);
    expect(lines!.stats.duplicates).toBe(1);
  });
});

describe("reading a CSV file", () => {
  it("finds the separator, keeps quoted commas and guesses types", () => {
    const t = parseCsv("old accounts.csv", 'code;name;opened\r\n1001;"Cash, main";2024-01-31\r\n4001;Tax;\r\n');
    expect(t.name).toBe("old_accounts");
    expect(t.columns.map((c) => [c.name, c.type])).toEqual([
      ["code", "number"],
      ["name", "text"],
      ["opened", "date"],
    ]);
    expect(t.rows).toEqual([
      { code: "1001", name: "Cash, main", opened: "2024-01-31" },
      { code: "4001", name: "Tax", opened: null },
    ]);
    expect(t.stats.nulls.opened).toBe(1);
  });
});
