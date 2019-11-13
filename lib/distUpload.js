var helpers = helpers || {};

/* for complex type a java hashmap is needed for binds */
helpers.getBindMap = function() {
	var HashMap = Java.type("java.util.HashMap");
	map = new HashMap();
	return map;
};

/* create a temp blob and load it from a local to sqlcl file */
helpers.getBlobFromFile = function(fileName) {
	try {
		var b = conn.createBlob();
		var out = b.setBinaryStream(1);
		var path = java.nio.file.FileSystems.getDefault().getPath(fileName);

		java.nio.file.Files.copy(path, out);
		out.flush();

		return b;
	} catch (e) {
		ctx.write(e);
	}
};

// builds an array of files given a top level directory
// recursively enters each sub directory and adds the files to the array
helpers.walkFileTree = function(path) {
	var cwd = new File(path);
	if (cwd.isDirectory()) {
		var pathFiles = cwd.listFiles();
		for (var f in pathFiles) {
			helpers.walkFileTree(pathFiles[f].getAbsolutePath());
		}
	} else {
		files[fileCount++] = cwd;
	}
};

var File = Java.type("java.io.File");

var dir = args[1];
var appID = args[2];
var api = args[3];
var pluginName = args[4];

var files = [];
var fileCount = 0;

helpers.walkFileTree(dir);

if (api.toLowerCase() == "theme") {
	createFileAPI = " wwv_flow_api.create_theme_file (" +
		" p_flow_id      => l_application_id," +
		" p_theme_id     => l_theme_number," +
		" p_file_name    => l_file_name," +
		" p_mime_type    => nvl(l_mime_type, 'application/octet-stream')," +
		" p_file_charset => 'utf-8'," +
		" p_file_content => :b);";
} else if (api.toLowerCase() == 'workspace') {
	createFileAPI = " wwv_flow_api.create_workspace_static_file (" +
		" p_file_name    => l_file_name," +
		" p_mime_type    => nvl(l_mime_type, 'application/octet-stream')," +
		" p_file_charset => 'utf-8'," +
		" p_file_content => :b);";
} else if (api.toLowerCase() == 'plugin') {
	createFileAPI =
		" begin" +
		"   select plugin_id" +
		"   into l_plugin_id" +
		"   from apex_appl_plugins" +
		"   where application_id = l_app_id" +
		"   and name = l_plugin_name" +
		"   ;" +

		"   wwv_flow_api.create_plugin_file (" +
		"   p_flow_id      => l_application_id," +
		"   p_plugin_id    => l_plugin_id," +
		"   p_file_name    => l_file_name," +
		"   p_mime_type    => nvl(l_mime_type, 'application/octet-stream')," +
		"   p_file_charset => 'utf-8'," +
		"   p_file_content => :b);" +
		" exception when no_data_found then" +
		"   raise_application_error(-20001, 'Plugin ' || l_plugin_name || ' is not valid.');" +
		" end; ";
} else {
	createFileAPI = " wwv_flow_api.create_app_static_file (" +
		" p_flow_id      => l_application_id," +
		" p_file_name    => l_file_name," +
		" p_mime_type    => nvl(l_mime_type, 'application/octet-stream')," +
		" p_file_charset => 'utf-8'," +
		" p_file_content => :b);";
}

for (var file in files) {
	/* load binds */
	binds = helpers.getBindMap();

	/* add more binds */
	binds.put("path", files[file].toString());
	binds.put("dir", dir);
	binds.put("app_id", appID);
	binds.put("plugin_name", pluginName);

	blob = helpers.getBlobFromFile(files[file]);

	ctx.write("Uploaded: " + files[file] + "\n");
	binds.put("b", blob);

	// exec the insert and pass binds
	var plsql =
		" declare" +
		"   l_file_name varchar2(4000);" +
		"   l_mime_type varchar2(4000);" +
		"   l_path varchar2(4000);" +
		"   l_dir varchar2(4000);" +

		// app_id is a varchar2 because it can come as an app alias too
		"   l_app_id varchar2(100) := :app_id;" +
		"   l_plugin_name varchar2(100) := :plugin_name;" +

		"   l_application_id apex_applications.application_id%type;" +
		"   l_workspace_id apex_applications.workspace_id%type;" +
		"   l_theme_number apex_applications.theme_number%type;" +
		"   l_plugin_id apex_appl_plugins.plugin_id%type;" +

		"   cursor c_mime_types (p_file_name in varchar2) is" +
		"   select mime_type" +
		"   from xmltable (" +
		"       xmlnamespaces (" +
		"       default 'http://xmlns.oracle.com/xdb/xdbconfig.xsd')," +
		"           '//mime-mappings/mime-mapping' " +
		"           passing xdb.dbms_xdb.cfg_get()" +
		"       columns" +
		"           extension varchar2(50) path 'extension'," +
		"           mime_type varchar2(100) path 'mime-type' " +
		"   )" +
		"   where lower(extension) = lower(substr(p_file_name, instr(p_file_name, '.', -1) + 1));" +
		" begin" +
		// simulates an APEX session to set the security_group_id
		"   select application_id, workspace_id, theme_number" +
		"   into l_application_id, l_workspace_id, l_theme_number" +
		"   from apex_applications" +
		"   where to_char(application_id) = l_app_id" +
		"   or upper(alias) = upper(l_app_id);" +

		"   apex_util.set_security_group_id (p_security_group_id => l_workspace_id);" +

		"   l_path := :path;" +
		"   l_dir := :dir;" +
		// eliminate the local dist path to get a real file name
		// "C:/dist/css/app.css" becomes "css/app.css"
		// dir and path are the same for a single file so becomes "app.css"
		"  if l_path != l_dir then" +
		"    l_file_name := substr(l_path, length(l_dir) + 2);" +
		"  else" +
		"    if instr(l_path, '/') > 0 then" +
		"      l_file_name := replace(l_path, substr(l_path, 1, instr(l_path, '/', -1, 1)), '');" +
		"    elsif instr(l_path, '\\') > 0 then" +
		"      l_file_name := replace(l_path, substr(l_path, 1, instr(l_path, '\\', -1, 1)), '');" +
		"    else" +
		"      l_file_name := l_path;" +
		"    end if;" +
		"  end if;" +
		"  l_file_name := replace(l_file_name, '\\', '/');" +

		// get the mime type for the current file
		"   for i in c_mime_types (p_file_name => l_file_name) loop" +
		"     l_mime_type := i.mime_type;" +
		"   end loop;" +

    // extra mime type checking
    " if l_mime_type is null then" +
    "   for rec in ( " + 
		"    select 'au'    as extension, 'audio/basic' as mime_type from sys.dual union all" +
		"    select 'avi'   as extension, 'video/x-msvideo' as mime_type from sys.dual union all" +
		"    select 'bin'   as extension, 'application/octet-stream' as mime_type from sys.dual union all" +
		"    select 'bmp'   as extension, 'image/bmp' as mime_type from sys.dual union all" +
		"    select 'css'   as extension, 'text/css' as mime_type from sys.dual union all" +
		"    select 'doc'   as extension, 'application/msword' as mime_type from sys.dual union all" +
		"    select 'docx'  as extension, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as mime_type from sys.dual union all" +
		"    select 'dot'   as extension, 'application/msword' as mime_type from sys.dual union all" +
		"    select 'eml'   as extension, 'message/rfc822' as mime_type from sys.dual union all" +
		"    select 'gif'   as extension, 'image/gif' as mime_type from sys.dual union all" +
		"    select 'htm'   as extension, 'text/html' as mime_type from sys.dual union all" +
		"    select 'html'  as extension, 'text/html' as mime_type from sys.dual union all" +
		"    select 'jpe'   as extension, 'image/jpeg' as mime_type from sys.dual union all" +
		"    select 'jpeg'  as extension, 'image/jpeg' as mime_type from sys.dual union all" +
		"    select 'jpg'   as extension, 'image/jpeg' as mime_type from sys.dual union all" +
		"    select 'js'    as extension, 'application/x-javascript' as mime_type from sys.dual union all" +
		"    select 'jsp'   as extension, 'text/html' as mime_type from sys.dual union all" +
		"    select 'mid'   as extension, 'audio/mid' as mime_type from sys.dual union all" +
		"    select 'mov'   as extension, 'video/quicktime' as mime_type from sys.dual union all" +
		"    select 'movie' as extension, 'video/x-sgi-movie' as mime_type from sys.dual union all" +
		"    select 'mp3'   as extension, 'audio/mpeg' as mime_type from sys.dual union all" +
		"    select 'mpe'   as extension, 'video/mpg' as mime_type from sys.dual union all" +
		"    select 'mpeg'  as extension, 'video/mpg' as mime_type from sys.dual union all" +
		"    select 'mpg'   as extension, 'video/mpg' as mime_type from sys.dual union all" +
		"    select 'msa'   as extension, 'application/x-msaccess' as mime_type from sys.dual union all" +
		"    select 'msw'   as extension, 'application/x-msworks-wp' as mime_type from sys.dual union all" +
		"    select 'pcx'   as extension, 'application/x-pc-paintbrush' as mime_type from sys.dual union all" +
		"    select 'pdf'   as extension, 'application/pdf' as mime_type from sys.dual union all" +
		"    select 'png'   as extension, 'image/png' as mime_type from sys.dual union all" +
		"    select 'ppt'   as extension, 'application/vnd.ms-powerpoint' as mime_type from sys.dual union all" +
		"    select 'pptx'  as extension, 'application/vnd.openxmlformats-officedocument.presentationml.presentation' as mime_type from sys.dual union all" +
		"    select 'ps'    as extension, 'application/postscript' as mime_type from sys.dual union all" +
		"    select 'qt'    as extension, 'video/quicktime' as mime_type from sys.dual union all" +
		"    select 'ra'    as extension, 'audio/x-realaudio' as mime_type from sys.dual union all" +
		"    select 'ram'   as extension, 'audio/x-realaudio' as mime_type from sys.dual union all" +
		"    select 'rm'    as extension, 'audio/x-realaudio' as mime_type from sys.dual union all" +
		"    select 'rtf'   as extension, 'application/rtf' as mime_type from sys.dual union all" +
		"    select 'rv'    as extension, 'video/x-realvideo' as mime_type from sys.dual union all" +
		"    select 'sgml'  as extension, 'text/sgml' as mime_type from sys.dual union all" +
		"    select 'svg'   as extension, 'image/svg+xml' as mime_type from sys.dual union all" +
		"    select 'tif'   as extension, 'image/tiff' as mime_type from sys.dual union all" +
		"    select 'tiff'  as extension, 'image/tiff' as mime_type from sys.dual union all" +
		"    select 'txt'   as extension, 'text/plain' as mime_type from sys.dual union all" +
		"    select 'url'   as extension, 'text/plain' as mime_type from sys.dual union all" +
		"    select 'vrml'  as extension, 'x-world/x-vrml' as mime_type from sys.dual union all" +
		"    select 'wav'   as extension, 'audio/wav' as mime_type from sys.dual union all" +
		"    select 'wpd'   as extension, 'application/wordperfect5.1' as mime_type from sys.dual union all" +
		"    select 'xls'   as extension, 'application/vnd.ms-excel' as mime_type from sys.dual union all" +
		"    select 'xlsx'  as extension, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as mime_type from sys.dual union all" +
		"    select 'xml'   as extension, 'text/xml' as mime_type from sys.dual union all" +
		"    select 'xsd'   as extension, 'text/xml' as mime_type from sys.dual union all" +
		"    select 'xsl'   as extension, 'text/xml' as mime_type from sys.dual union all" +
		"    select 'zip'   as extension, 'application/x-zip-compressed' as mime_type from sys.dual"+ 
    "  )" + 
    "  loop" + 
    "    if lower(rec.extension) = lower(substr(l_file_name, instr(l_file_name, '.', -1) + 1)) then" + 
	  "       l_mime_type := rec.mime_type;" +
    "    end if;" + 
    "   end loop;" + 
    " end if;" +

		// inserts the file
		"   execute immediate 'alter session set current_schema=' || apex_application.g_flow_schema_owner;" +
			createFileAPI +
		"   exception when no_data_found then" +
		"      raise_application_error(-20001, 'Application ' || l_app_id || ' is not valid.');" +
		" end;";

	// Add server output support
	sqlcl.setStmt("set serveroutput on");
	sqlcl.run();

	var ret = util.execute(plsql, binds);

	var ex = util.getLastException();

	if (ex) {
		ctx.write(ex + "\n");
	}
}
