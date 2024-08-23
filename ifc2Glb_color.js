const fs = require('fs');
const { IfcAPI } = require('web-ifc');
const { Document, NodeIO, Buffer } = require('@gltf-transform/core');
const { dedup } = require('@gltf-transform/functions');
const { KHRMaterialsUnlit } = require('@gltf-transform/extensions');

const scaleFactor = 50; // Scale factor for geometry

function applyTransformation(matrix, x, y, z) {
  const xNew = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * scaleFactor;
  const yNew = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * scaleFactor;
  const zNew = (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * scaleFactor;
  return [xNew, yNew, zNew];
}

function ifcGeometryToBuffer(color, vertexData, indexData, transform) {
  let posFloats = new Float32Array(vertexData.length / 2);
  let normFloats = new Float32Array(vertexData.length / 2);
  let colorFloats = new Float32Array(vertexData.length / 2);

  for (let i = 0; i < vertexData.length; i += 6) {
      const [x, y, z] = applyTransformation(transform, vertexData[i], vertexData[i + 1], vertexData[i + 2]);
      posFloats[i / 2 + 0] = x;
      posFloats[i / 2 + 1] = y;
      posFloats[i / 2 + 2] = z;

      const [nx, ny, nz] = applyTransformation(transform, vertexData[i + 3], vertexData[i + 4], vertexData[i + 5]);
      normFloats[i / 2 + 0] = nx;
      normFloats[i / 2 + 1] = ny;
      normFloats[i / 2 + 2] = nz;

      colorFloats[i / 2 + 0] = color.x;
      colorFloats[i / 2 + 1] = color.y;
      colorFloats[i / 2 + 2] = color.z;
  }

  return {
      posFloats,
      normFloats,
      colorFloats,
  };
}

async function convertIfcToGlb(ifcFilePath, outputFilePath) {
  // Initialize IFC API
  const ifcapi = new IfcAPI();
  await ifcapi.Init();

  // Read the IFC file
  const ifcData = fs.readFileSync(ifcFilePath);
  const modelID = ifcapi.OpenModel(ifcData, { COORDINATE_TO_ORIGIN: true });

  // Create a new GLTFTransform document
  const document = new Document();
  const scene = document.createScene();

  // Create a buffer for storing geometry data
  const buffer = document.createBuffer();
  buffer.setURI('data.bin'); // You can name the buffer anything

  // Process each mesh in the IFC file
  ifcapi.StreamAllMeshes(modelID, (mesh, index) => {
    const placedGeometries = mesh.geometries;
    for (let i = 0; i < placedGeometries.size(); i++) {
      const placedGeometry = placedGeometries.get(i);
      const geometry = ifcapi.GetGeometry(modelID, placedGeometry.geometryExpressID);
      const verts = ifcapi.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      // const normals = ifcapi.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize(), 3); // Correctly get normals
      const indices = ifcapi.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
      const bufferGeometry = ifcGeometryToBuffer(placedGeometry.color, verts, indices, placedGeometry.flatTransformation);

      if (verts.length === 0 || indices.length === 0) continue;

      // Apply transformation to vertices and normals
      const transformedVerts = [];
      const transformedNormals = [];

      const posFloats = bufferGeometry.posFloats;
      for (let j = 0; j < posFloats.length; j += 3) {
        // objContent += `v ${posFloats[j]} ${posFloats[j + 1]} ${posFloats[j + 2]}\n`;
        const [x, y, z] = [posFloats[j], posFloats[j + 1], posFloats[j + 2]];
        transformedVerts.push(x, y, z);
      }

      const normFloats = bufferGeometry.normFloats;
      for (let j = 0; j < normFloats.length; j += 3) {
        // objContent += `vn ${normFloats[j]} ${normFloats[j + 1]} ${normFloats[j + 2]}\n`;
        const [nx, ny, nz] = [normFloats[j], normFloats[j + 1], normFloats[j + 2]];
        transformedNormals.push(nx, ny, nz);
      }

      

      // Create position accessor
      const positionAccessor = document.createAccessor()
        .setArray(new Float32Array(transformedVerts))
        .setBuffer(buffer)
        .setType('VEC3');

      // Create normal accessor
      const normalAccessor = document.createAccessor()
        .setArray(new Float32Array(transformedNormals))
        .setBuffer(buffer)
        .setType('VEC3');

      const colorFloats = bufferGeometry.colorFloats;
      // Create color accessor
      const colorAccessor = document.createAccessor()
        .setArray(new Float32Array(colorFloats))
        .setBuffer(buffer)
        .setType('VEC3');

      // Create index accessor
      const indexAccessor = document.createAccessor()
        .setArray(new Uint32Array(indices))
        .setBuffer(buffer)
        .setType('SCALAR');

      // Create a Primitive and Mesh
      const primitive = document.createPrimitive()
        .setAttribute('POSITION', positionAccessor)
        .setAttribute('NORMAL', normalAccessor) // Add normals to the primitive
        .setAttribute('COLOR_0', colorAccessor) // Add colors to the primitive
        .setIndices(indexAccessor);

      const mesh = document.createMesh(`mesh_${index}_${i}`)
        .addPrimitive(primitive);

      // Create material based on color
      // const material = document.createMaterial()
      //   .setBaseColorFactor([placedGeometry.color.x, placedGeometry.color.y, placedGeometry.color.z, placedGeometry.color.w]);
      
      // Enable the KHR_materials_unlit extension
      // Create an Extension attached to the Document.
      const unlitExtension = document.createExtension(KHRMaterialsUnlit);
      // Create an Unlit property.
      const unlit = unlitExtension.createUnlit();
      // Create the unlit material
      const material = document.createMaterial()
        .setBaseColorFactor([placedGeometry.color.x, placedGeometry.color.y, placedGeometry.color.z, placedGeometry.color.w])
        .setMetallicFactor(0.0)  // Set to 0 to avoid darkening due to metallic reflection
        .setRoughnessFactor(0.9); // Increase roughness to make the material more diffuse and less shiny
      material.setEmissiveFactor([placedGeometry.color.x * 0.5, placedGeometry.color.y * 0.5, placedGeometry.color.z * 0.5]);
      material.setExtension('KHR_materials_unlit', unlit);


      primitive.setMaterial(material);

      // Create a node with the mesh
      const node = document.createNode(`node_${index}_${i}`)
        .setMesh(mesh);

      // Add node to scene
      scene.addChild(node);

      geometry.delete();
    }
  });

  // Apply deduplication to remove redundant data
  await document.transform(
    dedup()
  );

  // Write the GLB file
  const io = new NodeIO();
  io.registerExtensions([KHRMaterialsUnlit]);
  io.write(outputFilePath, document);

  // Close the IFC model
  ifcapi.CloseModel(modelID);
}

// Run the conversion
convertIfcToGlb('example.ifc', 'example1.glb')
  .then(() => console.log('Conversion to GLB complete'))
  .catch(error => console.error('Conversion failed:', error));
